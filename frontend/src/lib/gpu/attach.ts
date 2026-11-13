// Shared write core of the GPU attach and release actions (#672): the
// provider GPU page and the tenant vDC route both go through it. It finds or
// creates the resource mapping of a card, checks a vGPU profile is still
// offered by PVE, writes or removes the hostpciN. Permission and quota checks
// stay with the callers.
import {
  hostpciValue,
  isMappedHostpci,
  mappingIdFor,
  mappingMapEntry,
  nextHostpciIndex,
  vgpuMapEntries,
  vgpuMappingIdFor,
} from '@/lib/gpu/actions'
import { resetGpuSnapshotCache } from '@/lib/gpu/collect'
import { configFromPending, type PvePendingEntry } from '@/lib/gpu/guestConfigSource'
import type { GpuReportDevice } from '@/lib/gpu/report'
import { pveFetch } from '@/lib/proxmox/client'
import { writeGuestConfig } from '@/lib/proxmox/guestConfigWrite'

export type WriteResult =
  | { ok: true; hostpci: string; mappingId: string; mappingCreated: boolean; pending: boolean }
  | { ok: false; code: string; status: number }

type Failure = { ok: false; code: string; status: number }

const fail = (code: string, status: number): Failure => ({ ok: false, code, status })

const form = (fields: Record<string, string | undefined>) => {
  const f = new URLSearchParams()
  for (const [k, v] of Object.entries(fields)) if (v !== undefined) f.set(k, v)
  return f.toString()
}

/** What a GPU write works on: the VM config, and the keys whose removal is pending. */
export type VmPendingView = { config: Record<string, unknown>; pendingDelete: Set<string> }

/**
 * The VM read through /pending, one call: the pending value of each key, a
 * hostpciN whose removal is pending kept at its current value. The VM still
 * runs that GPU until it stops, so its slot is never handed out again (a
 * write there would turn the pending delete into a pending swap and drop the
 * GPU from the count). The digest comes back as a plain row. null when the
 * VM cannot be read.
 */
export async function readVmPending(conn: any, node: string, vmid: string): Promise<VmPendingView | null> {
  try {
    const rows = await pveFetch<unknown>(conn, `/nodes/${encodeURIComponent(node)}/qemu/${encodeURIComponent(vmid)}/pending`)
    if (!Array.isArray(rows)) return null
    const pendingDelete = new Set(
      (rows as PvePendingEntry[]).filter(r => r && typeof r.key === 'string' && Number(r.delete ?? 0) > 0).map(r => r.key),
    )
    return { config: configFromPending(rows as PvePendingEntry[]), pendingDelete }
  } catch {
    return null
  }
}

/** The config a GPU write works on (see readVmPending); null when the VM cannot be read. */
export async function readVmConfig(conn: any, node: string, vmid: string): Promise<Record<string, unknown> | null> {
  return (await readVmPending(conn, node, vmid))?.config ?? null
}

async function vmRunning(conn: any, node: string, vmid: string): Promise<boolean> {
  try {
    const status = await pveFetch<{ status?: string }>(conn, `/nodes/${encodeURIComponent(node)}/qemu/${encodeURIComponent(vmid)}/status/current`)
    return status?.status === 'running'
  } catch {
    return false
  }
}

async function postMapping(conn: any, body: string, label: string): Promise<Failure | null> {
  try {
    await pveFetch(conn, '/cluster/mapping/pci', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    })
    return null
  } catch (e: any) {
    console.error(`[gpu-actions] ${label} creation failed:`, e?.message)
    return fail('mapping_failed', 502)
  }
}

/** The mapping that covers the card, or the one created for it (whole card or, with a profile, mediated devices). */
async function mappingFor(
  conn: any,
  device: GpuReportDevice,
  vgpu: boolean,
  beforeMappingCreate?: () => Promise<Response | null>,
): Promise<{ ok: true; mappingId: string; created: boolean } | Failure | { ok: false; denied: Response }> {
  const existing = vgpu ? device.vgpuMappings?.[0] : device.mappings[0]
  if (existing) return { ok: true, mappingId: existing, created: false }

  const denied = await beforeMappingCreate?.()
  if (denied) return { ok: false, denied }

  let mappingId: string
  let body: string
  if (vgpu) {
    const entries = vgpuMapEntries(device)
    if (!entries) return fail('device_ids_unknown', 409)
    mappingId = vgpuMappingIdFor(device)
    const params = new URLSearchParams({ id: mappingId, mdev: '1', description: `ProxCenter vGPU ${device.deviceName ?? ''}`.trim() })
    for (const e of entries) params.append('map', e)
    body = params.toString()
  } else {
    const entry = mappingMapEntry(device)
    if (!entry) return fail('device_ids_unknown', 409)
    mappingId = mappingIdFor(device)
    body = form({ id: mappingId, map: entry, description: `ProxCenter GPU ${device.deviceName ?? ''}`.trim() })
  }
  const failed = await postMapping(conn, body, vgpu ? 'vGPU mapping' : 'mapping')
  return failed ?? { ok: true, mappingId, created: true }
}

/** The profile must still fit on the card: PVE lists the types a free slot can take. */
async function profileOffered(conn: any, node: string, mappingId: string, profile: string): Promise<Failure | null> {
  try {
    const types = await pveFetch<Array<{ type?: string; available?: number }>>(
      conn,
      `/nodes/${encodeURIComponent(node)}/hardware/pci/${encodeURIComponent(mappingId)}/mdev`,
    )
    const offered = (types ?? []).find(t => t.type === profile)
    return offered && Number(offered.available) > 0 ? null : fail('profile_unavailable', 409)
  } catch (e: any) {
    console.error('[gpu-actions] vGPU profiles unreadable:', e?.message)
    return fail('pve_refused', 502)
  }
}

/**
 * Give a VM a GPU: the whole card (profile null) or a vGPU of it (profile
 * nvidia-NNN), at its next free hostpciN. `beforeMappingCreate` runs only when
 * a mapping has to be created; a Response from it stops the write.
 */
export async function writeGpu(
  conn: any,
  device: GpuReportDevice,
  vmid: string,
  config: Record<string, unknown>,
  opts: { profile: string | null; beforeMappingCreate?: () => Promise<Response | null> },
): Promise<WriteResult | { ok: false; denied: Response }> {
  const index = nextHostpciIndex(config)
  if (index < 0) return fail('no_free_slot', 409)

  const mapping = await mappingFor(conn, device, !!opts.profile, opts.beforeMappingCreate)
  if (mapping.ok === false) return mapping
  if (opts.profile) {
    const unavailable = await profileOffered(conn, device.node, mapping.mappingId, opts.profile)
    if (unavailable) return unavailable
  }

  const hostpci = `hostpci${index}`
  try {
    await writeGuestConfig({
      conn,
      type: 'qemu',
      node: device.node,
      vmid,
      body: form({ [hostpci]: hostpciValue(mapping.mappingId, config, opts.profile), digest: config.digest ? String(config.digest) : undefined }),
    })
  } catch (e: any) {
    console.error('[gpu-actions] attach failed:', e?.message)
    return fail('pve_refused', 502)
  }
  resetGpuSnapshotCache()
  return { ok: true, hostpci, mappingId: mapping.mappingId, mappingCreated: mapping.created, pending: await vmRunning(conn, device.node, vmid) }
}

/** Remove a mapped hostpciN. A raw-address one is refused: PVE lets only root@pam password sessions touch it. */
export async function removeGpu(
  conn: any,
  node: string,
  vmid: string,
  hostpci: string,
  config: Record<string, unknown>,
): Promise<{ ok: true; pending: boolean } | Failure> {
  if (!isMappedHostpci(config[hostpci])) return fail('contact_provider', 409)
  try {
    await writeGuestConfig({
      conn,
      type: 'qemu',
      node,
      vmid,
      body: form({ delete: hostpci, digest: config.digest ? String(config.digest) : undefined }),
    })
  } catch (e: any) {
    console.error('[gpu-actions] release failed:', e?.message)
    return fail('pve_refused', 502)
  }
  resetGpuSnapshotCache()
  return { ok: true, pending: await vmRunning(conn, node, vmid) }
}
