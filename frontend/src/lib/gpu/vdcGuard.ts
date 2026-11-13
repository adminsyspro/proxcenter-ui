// The vDC GPU contingent (#672) on the generic paths: a vDC tenant adds a GPU
// through its vDC GPU section only, a clone or a restore of a VM with GPUs
// draws on the contingent, the provider's GPU page respects it for a VM of a
// vDC pool, and the hardware dialog of a tenant never offers a mapping
// covering a GPU. A collection that could not read everything it needs
// refuses: what it missed may be a GPU.
import { NextResponse } from 'next/server'

import { getConnectionById } from '@/lib/connections/getConnection'
import { prisma } from '@/lib/db/prisma'
import { pveFetch } from '@/lib/proxmox/client'

import { getConnectionGpus, type ConnectionGpuSnapshot } from './collect'
import { addressMatchesDevice, parseHostpciEntries, parsePciMappings, type GpuDevice } from './inventory'
import type { VisibleVgpuType } from './metricsShared'
import { countGpuRefs, hostpciEntries } from './quota'
import { loadVdcGpuContext, type VdcGpuContext, type VdcRef } from './vdcContext'
import { listVdcGpuEntries } from './vdcEntries'
import { vdcUsage } from './vdcPending'
import { checkDemand, modelKeyOf, type GpuDemand, type VdcGpuEntry } from './vdcQuota'
import { profileName } from './vgpu'

const VDC_REF = { id: true, tenantId: true, connectionId: true, pvePoolName: true, enabled: true } as const

export type ContingentVerdict =
  | { ok: true; demand: GpuDemand[] }
  | { ok: false; code: 'quota_exhausted'; used: number; count: number }
  | { ok: false; code: 'gpu_check_unavailable' }

/** What could not be read may be a GPU or a line already full: nothing is judged. */
const UNAVAILABLE = { ok: false as const, code: 'gpu_check_unavailable' as const }

/** The answer of a refused verdict: the line and its use, or "cannot be checked now". */
export function contingentRefusal(verdict: Exclude<ContingentVerdict, { ok: true }>): Response {
  return verdict.code === 'gpu_check_unavailable'
    ? NextResponse.json({ error: 'gpu_check_unavailable' }, { status: 503 })
    : NextResponse.json({ error: 'quota_exhausted', used: verdict.used, count: verdict.count }, { status: 409 })
}

/**
 * A vGPU whose profile is unknown, or of a model the pool holds unresolved
 * vGPUs of, cannot be judged: the line it draws on is not known to be free.
 */
export function demandUncheckable(demand: GpuDemand[], unresolvedModels: Set<string>): boolean {
  return demand.some((d) => d.kind === 'vgpu' && (d.profileName === null || unresolvedModels.has(d.modelKey)))
}

/** The demand judged against the contingent of a context, with the usage given. */
function judge(ctx: Pick<VdcGpuContext, 'entries' | 'unresolvedVgpuModels'>, usage: Map<string, number>, demand: GpuDemand[]): ContingentVerdict {
  if (demand.length === 0) return { ok: true, demand }
  if (demandUncheckable(demand, ctx.unresolvedVgpuModels)) return UNAVAILABLE
  const verdict = checkDemand(ctx.entries, usage, demand)
  return verdict.ok === false ? { ok: false, code: 'quota_exhausted', used: verdict.used, count: verdict.count } : { ok: true, demand }
}

/** The cached GPU collection of a connection, read with its owner's token. */
async function cachedSnapshot(connId: string): Promise<ConnectionGpuSnapshot> {
  const row = await prisma.connection.findFirst({
    where: { id: connId, type: 'pve' },
    select: { id: true, tenantId: true, name: true },
  })
  if (!row) throw new Error('GPU connection not found')
  const conn = await getConnectionById(row.id, row.tenantId)
  return getConnectionGpus(conn, { id: row.id, name: row.name })
}

type SnapshotHealth = Pick<ConnectionGpuSnapshot, 'error' | 'mappingsError' | 'nodes'> & { guestsError?: string | null }

/** Nodes whose PCI list was read. */
export const scannedNodes = (snap: Pick<ConnectionGpuSnapshot, 'nodes'>) =>
  new Set(snap.nodes.filter((n) => n.online && n.error === null).map((n) => n.node))

/** The devices and their mappings are known, on every node. */
const devicesKnown = (snap: SnapshotHealth) =>
  snap.error === null && snap.mappingsError === null && snap.nodes.every((n) => n.online && n.error === null)

/** The devices, the mappings and what every guest holds are known. */
export const fullyRead = (snap: SnapshotHealth) => devicesKnown(snap) && !snap.guestsError

/**
 * What a hostpciN value hands the VM when it is a GPU (mapping or address, and
 * profile); null otherwise. A mapping is cluster-wide: one covering a GPU of
 * any node counts, as the VM may start on that node. A raw address is read on
 * the VM node.
 */
function gpuTarget(snap: ConnectionGpuSnapshot, gpuMappings: Set<string>, node: string, key: string, value: unknown): string | null {
  const ref = parseHostpciEntries({ [key]: value })[0]
  if (!ref) return null
  const gpu = ref.mapping ? gpuMappings.has(ref.mapping) : countGpuRefs(snap, node, { [key]: value }) > 0
  return gpu ? JSON.stringify([ref.mapping, ref.addresses, ref.mdev]) : null
}

/** What a hostpciN write does to the GPUs of a VM: hands it one, none, or the collection cannot tell. */
export type GpuAddVerdict = 'adds' | 'none' | 'unknown'

/** The target of a hostpciN value, GPU or not: what tells an option change from another device. */
const refKey = (key: string, value: unknown) => {
  const ref = parseHostpciEntries({ [key]: value })[0]
  return ref ? JSON.stringify([ref.mapping, ref.addresses, ref.mdev]) : null
}

/**
 * Whether the hostpciN entries written hand the VM a GPU it did not hold:
 * a new one, another card or another vGPU profile in place of the previous
 * value of that entry. Changing the options of a GPU already held adds none,
 * except over a slot listed in `held` (its current and pending values): a
 * slot that holds a GPU now or at the next start is touched by a removal
 * only, so any write there counts as adding one.
 * 'unknown' when the collection could not read the connection, the mappings
 * or the VM node, or for a mapping it does not know as a GPU while a node of
 * the cluster went unread: what it missed may be a GPU.
 */
export async function tenantAddsGpu(
  connId: string,
  node: string,
  written: Record<string, unknown>,
  previous: Record<string, unknown>,
  held: Record<string, unknown[]> = {},
): Promise<GpuAddVerdict> {
  const entries = Object.entries(written)
  if (entries.length === 0) return 'none'
  let snap: ConnectionGpuSnapshot
  try {
    snap = await cachedSnapshot(connId)
  } catch (e: any) {
    console.warn('[vdc-gpu] GPU collection unreadable, hostpci write refused:', e?.message || String(e))
    return 'unknown'
  }
  if (snap.error !== null || snap.mappingsError !== null || !scannedNodes(snap).has(node)) return 'unknown'
  const gpuMappings = gpuMappingIdsOf(snap)
  const everyNodeRead = devicesKnown(snap)
  /** A value is a GPU, is not one, or, for an unknown mapping on a partly read cluster, may be one. */
  const judge = (key: string, value: unknown): 'gpu' | 'other' | 'unknown' => {
    if (gpuTarget(snap, gpuMappings, node, key, value) !== null) return 'gpu'
    const ref = parseHostpciEntries({ [key]: value })[0]
    return ref?.mapping && !everyNodeRead ? 'unknown' : 'other'
  }
  let unknown = false
  for (const [key, value] of entries) {
    const heldNow = (held[key] ?? []).map((v) => judge(key, v))
    if (heldNow.includes('gpu')) return 'adds'
    if (heldNow.includes('unknown')) unknown = true
    if (refKey(key, value) === refKey(key, previous[key])) continue
    const now = judge(key, value)
    if (now === 'gpu') return 'adds'
    if (now === 'unknown') unknown = true
  }
  return unknown ? 'unknown' : 'none'
}

/**
 * The current and the pending value of each hostpciN of a VM, with one
 * /pending read; null when PVE cannot answer.
 */
export async function heldHostpci(conn: unknown, node: string, vmid: string): Promise<Record<string, unknown[]> | null> {
  try {
    const rows = await pveFetch<unknown>(conn as any, `/nodes/${encodeURIComponent(node)}/qemu/${encodeURIComponent(vmid)}/pending`)
    if (!Array.isArray(rows)) return null
    const out: Record<string, unknown[]> = {}
    for (const row of rows as Array<{ key?: unknown; value?: unknown; pending?: unknown }>) {
      if (typeof row?.key !== 'string' || !/^hostpci\d+$/.test(row.key)) continue
      const values = [row.value, row.pending].filter((v) => v !== undefined && v !== null && v !== '')
      if (values.length > 0) out[row.key] = values
    }
    return out
  } catch (e: any) {
    console.warn('[vdc-gpu] VM pending config unreadable, hostpci write refused:', e?.message || String(e))
    return null
  }
}

/** The answer of a hostpciN write a vDC tenant may not make; null when it may. */
export function gpuAddRefusal(verdict: GpuAddVerdict): Response | null {
  if (verdict === 'adds') return NextResponse.json({ error: 'gpu_via_my_vdc' }, { status: 409 })
  if (verdict === 'unknown') return NextResponse.json({ error: 'gpu_check_unavailable' }, { status: 503 })
  return null
}

async function vdcRef(vdcId: string, connId: string, pool: string): Promise<VdcRef | null> {
  const vdc = await prisma.vdc.findFirst({ where: { id: vdcId }, select: VDC_REF })
  return vdc ? { ...vdc, connectionId: connId, pvePoolName: pool } : null
}

/**
 * Whether a clone fits the contingent of the vDC it lands in: the clone holds
 * every GPU of its source config (`hostpci`, the source on `node`), a mapping
 * of any node of the connection included. Read on a fresh collection; a
 * contingent or a collection that cannot be read whole cannot be checked.
 * `demand` is what the clone will hold.
 */
export async function cloneContingentCheck(
  vdcId: string,
  connId: string,
  pool: string,
  node: string,
  hostpci: Record<string, unknown>,
): Promise<ContingentVerdict> {
  try {
    const ref = await vdcRef(vdcId, connId, pool)
    if (!ref) return UNAVAILABLE
    const ctx = await loadVdcGpuContext(ref, { refresh: true })
    if (!fullyRead(ctx.snapshot)) return UNAVAILABLE
    return judge(ctx, ctx.usage, archiveGpuDemand(ctx.report.devices, node, hostpciEntries(hostpci) as Record<string, string>, ctx.catalog))
  } catch (e: any) {
    console.warn('[vdc-gpu] contingent unreadable, clone refused:', e?.message || String(e))
    return UNAVAILABLE
  }
}

/** The main section of a backed-up VM config (PVE answers it as text), up to its first snapshot or pending section. */
export function parseArchiveConfig(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of text.split('\n')) {
    if (line.startsWith('[')) break
    const m = /^([a-z][a-z0-9_-]*):\s*(.*)$/i.exec(line.trim())
    if (m) out[m[1]] = m[2]
  }
  return out
}

/** The hostpciN of the config inside a backup archive, with one PVE call; null when it cannot be read. */
export async function archiveGpuConfig(conn: unknown, node: string, archive: string): Promise<Record<string, string> | null> {
  try {
    const text = await pveFetch<unknown>(conn as any, `/nodes/${encodeURIComponent(node)}/vzdump/extractconfig?volume=${encodeURIComponent(archive)}`)
    if (typeof text !== 'string') return null
    return hostpciEntries(parseArchiveConfig(text)) as Record<string, string>
  } catch (e: any) {
    console.warn('[vdc-gpu] backup config unreadable:', e?.message || String(e))
    return null
  }
}

/**
 * The GPUs a config would hand a VM restored on `node`: a mapping is
 * cluster-wide and resolves on any node, a raw address on the target node.
 * Entries that point at no GPU are left out.
 */
export function archiveGpuDemand(
  devices: Array<Pick<GpuDevice, 'key' | 'node' | 'kind' | 'mappings' | 'slot' | 'displayFunctions' | 'vgpu' | 'vendorId' | 'deviceId'>>,
  node: string,
  hostpci: Record<string, string>,
  catalog: VisibleVgpuType[],
): GpuDemand[] {
  const gpus = devices.filter((d) => d.kind === 'gpu')
  const demand: GpuDemand[] = []
  for (const ref of parseHostpciEntries(hostpci)) {
    const device = ref.mapping
      ? gpus.find((d) => d.mappings.includes(ref.mapping as string))
      : gpus.find((d) => d.node === node && ref.addresses.some((a) => addressMatchesDevice(a, d)))
    if (!device) continue
    demand.push({
      kind: ref.mdev ? 'vgpu' : 'whole',
      modelKey: modelKeyOf(device),
      profileName: ref.mdev ? profileName(ref.mdev, device.key, catalog) : null,
    })
  }
  return demand
}

/**
 * Whether restoring a backup whose config holds `hostpci` fits the contingent
 * of the vDC: the restored VM holds those GPUs. The VM a forced restore
 * overwrites gives its own GPUs back. An archive that holds no GPU, read on
 * the cached collection, needs no fresh one. `demand` is what the restored VM
 * will hold.
 */
export async function restoreContingentCheck(
  vdcId: string,
  connId: string,
  pool: string,
  node: string,
  hostpci: Record<string, string>,
  overwrittenVmid: string | null,
): Promise<ContingentVerdict> {
  if (Object.keys(hostpci).length === 0) return { ok: true, demand: [] }
  try {
    const cached = await cachedSnapshot(connId)
    if (devicesKnown(cached) && archiveGpuDemand(cached.devices, node, hostpci, []).length === 0) return { ok: true, demand: [] }

    const ref = await vdcRef(vdcId, connId, pool)
    if (!ref) return UNAVAILABLE
    const ctx = await loadVdcGpuContext(ref, { refresh: true })
    if (!fullyRead(ctx.snapshot)) return UNAVAILABLE
    const demand = archiveGpuDemand(ctx.report.devices, node, hostpci, ctx.catalog)
    const usage = vdcUsage(vdcId, ctx.entries, ctx.gpus.filter((g) => g.vmid !== overwrittenVmid))
    return judge(ctx, usage, demand)
  } catch (e: any) {
    console.warn('[vdc-gpu] contingent unreadable, restore refused:', e?.message || String(e))
    return UNAVAILABLE
  }
}

/**
 * The contingent of the vDC whose pool holds a VM. `refresh: false` reuses
 * the collection a caller has just read again under the connection lock.
 * null when the VM is in no pool, the pool belongs to no vDC, or the vDC has
 * no contingent line: no ceiling applies then.
 */
export async function vdcContingentForVm(
  connId: string,
  pool: string | null,
  opts: { refresh: boolean },
): Promise<{
  vdcId: string
  entries: VdcGpuEntry[]
  usage: Map<string, number>
  catalog: VisibleVgpuType[]
  unresolvedVgpuModels: Set<string>
} | null> {
  if (!pool) return null
  const vdc: VdcRef | null = await prisma.vdc.findFirst({ where: { connectionId: connId, pvePoolName: pool }, select: VDC_REF })
  if (!vdc) return null
  if ((await listVdcGpuEntries(vdc.id)).length === 0) return null
  const ctx = await loadVdcGpuContext(vdc, { refresh: opts.refresh })
  return { vdcId: vdc.id, entries: ctx.entries, usage: ctx.usage, catalog: ctx.catalog, unresolvedVgpuModels: ctx.unresolvedVgpuModels }
}

function gpuMappingIdsOf(snap: Pick<ConnectionGpuSnapshot, 'devices'>): Set<string> {
  const ids = new Set<string>()
  for (const d of snap.devices) {
    if (d.kind !== 'gpu') continue
    for (const id of [...d.mappings, ...(d.vgpuMappings ?? [])]) ids.add(id)
  }
  return ids
}

/** Every resource mapping of the connection that covers a GPU, vGPU mappings included. */
export async function gpuMappingIds(connId: string): Promise<Set<string>> {
  return gpuMappingIdsOf(await cachedSnapshot(connId))
}

/**
 * The PCI mappings a vDC tenant may see: none that covers a GPU, and none
 * that names a node whose devices were not read. Nothing at all when the
 * connection or its mappings could not be read.
 */
export async function tenantPciMappings(connId: string, mappings: unknown[]): Promise<unknown[]> {
  let snap: ConnectionGpuSnapshot
  try {
    snap = await cachedSnapshot(connId)
  } catch (e: any) {
    console.warn('[vdc-gpu] GPU collection unreadable, PCI mappings withheld:', e?.message || String(e))
    return []
  }
  if (snap.error !== null || snap.mappingsError !== null) return []
  const gpus = gpuMappingIdsOf(snap)
  const scanned = scannedNodes(snap)
  const nodesOf = new Map(parsePciMappings(mappings).map((p) => [p.id, p.entries.map((e) => e.node)]))
  return mappings.filter((m) => {
    const id = String((m as { id?: unknown } | null)?.id ?? '')
    return !gpus.has(id) && (nodesOf.get(id) ?? []).every((n) => scanned.has(n))
  })
}
