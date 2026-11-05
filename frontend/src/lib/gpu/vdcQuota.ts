// Per-profile GPU contingent of a vDC (#672): what the VMs of a vDC pool
// consume, whether a demand fits, and what a provider may offer. Pure and
// client-safe.
import type { VisibleVgpuType } from './metricsShared'
import type { GpuReport } from './report'
import { parseProfile, profileCapacity, profileName } from './vgpu'

export type GpuEntryKind = 'vgpu' | 'whole'

/** One line of the contingent: a vGPU profile of a card model, or whole cards of a model. */
export type VdcGpuEntry = {
  id: string
  kind: GpuEntryKind
  modelKey: string
  modelName: string
  /** Catalog name without the vendor prefix; '' for whole cards. */
  profileName: string
  count: number
}

/** A GPU held by a VM of a pool. */
export type PoolGpu = {
  vmid: string
  vmName: string
  vmStatus: string
  node: string
  hostpci: string
  deviceKey: string
  kind: GpuEntryKind
  modelKey: string
  modelName: string
  profileName: string | null
  mdev: string | null
  template: boolean
  via: 'address' | 'mapping'
  smbiosUuid: string | null
  /** Released from a running VM, held until it stops: still counted. */
  pendingRemoval: boolean
}

export type GpuDemand = Pick<PoolGpu, 'kind' | 'modelKey' | 'profileName'>

/** Same key as profileCapacity uses for a card model. */
export const modelKeyOf = (d: { vendorId: string | null; deviceId: string | null }) =>
  `${d.vendorId ?? '?'}:${d.deviceId ?? '?'}`.toLowerCase()

/** The GPUs held by the VMs of one pool, from an infrastructure-scope report. */
export function poolGpus(report: GpuReport, pool: string, catalog: VisibleVgpuType[]): PoolGpu[] {
  const out: PoolGpu[] = []
  for (const a of report.allocations) {
    if (a.hidden || a.kind !== 'gpu' || a.pool !== pool || !a.deviceKey || !a.vmid) continue
    out.push({
      vmid: a.vmid,
      vmName: a.vmName ?? '',
      vmStatus: a.vmStatus ?? '',
      node: a.node,
      hostpci: a.hostpci ?? '',
      deviceKey: a.deviceKey,
      kind: a.mdev ? 'vgpu' : 'whole',
      modelKey: modelKeyOf(a),
      modelName: a.deviceName ?? '',
      profileName: profileName(a.mdev, a.deviceKey, catalog),
      mdev: a.mdev,
      template: a.template,
      via: a.via,
      smbiosUuid: a.smbiosUuid,
      pendingRemoval: a.pendingRemoval === true,
    })
  }
  return out
}

/**
 * Models of the pool vGPUs, templates aside, whose profile the catalog does
 * not name (the host of their card was not read this round): they count on no
 * line, so no vGPU line of these models can be judged.
 */
export function unresolvedVgpuModelsOf(gpus: Array<Pick<PoolGpu, 'kind' | 'modelKey' | 'profileName' | 'template'>>): Set<string> {
  return new Set(gpus.filter((g) => g.kind === 'vgpu' && !g.template && g.profileName === null).map((g) => g.modelKey))
}

/** The line of the contingent a GPU draws on; null when it is off-contingent. */
export function matchEntry(entries: VdcGpuEntry[], g: GpuDemand): VdcGpuEntry | null {
  return entries.find((e) => e.kind === g.kind && e.modelKey === g.modelKey && (g.kind === 'whole' || e.profileName === g.profileName)) ?? null
}

/** GPUs held per entry. Templates and off-contingent GPUs are counted nowhere. */
export function entryUsage(entries: VdcGpuEntry[], gpus: Array<GpuDemand & { template: boolean }>): Map<string, number> {
  const usage = new Map(entries.map((e) => [e.id, 0]))
  for (const g of gpus) {
    if (g.template) continue
    const e = matchEntry(entries, g)
    if (e) usage.set(e.id, (usage.get(e.id) ?? 0) + 1)
  }
  return usage
}

/** Whether the demand fits what is left of the contingent. An entry lowered under what is held refuses everything. */
export function checkDemand(
  entries: VdcGpuEntry[],
  usage: Map<string, number>,
  demand: GpuDemand[],
): { ok: true } | { ok: false; entryId: string | null; used: number; count: number } {
  const planned = new Map<string, number>()
  for (const d of demand) {
    const e = matchEntry(entries, d)
    if (!e) return { ok: false, entryId: null, used: 0, count: 0 }
    const used = (usage.get(e.id) ?? 0) + (planned.get(e.id) ?? 0)
    if (used + 1 > e.count) return { ok: false, entryId: e.id, used, count: e.count }
    planned.set(e.id, (planned.get(e.id) ?? 0) + 1)
  }
  return { ok: true }
}

/** What a provider may put in a contingent, with what is free on the hardware now. */
export type GpuOffer = {
  kind: GpuEntryKind
  modelKey: string
  modelName: string
  profileName: string
  fbMemory: number | null
  freeNow: number
}

const SERIES_RANK: Record<string, number> = { Q: 0, C: 0 }
const seriesRank = (name: string) => SERIES_RANK[parseProfile(name)?.series ?? ''] ?? 1

/** Profiles of the SR-IOV cards and whole models of one connection. */
export function quotaOffers(report: GpuReport, catalog: VisibleVgpuType[], connId: string): GpuOffer[] {
  const cards = report.devices.filter((d) => d.kind === 'gpu' && d.connId === connId)
  const allocations = report.allocations.filter((a) => a.connId === connId)
  const offers: GpuOffer[] = []

  const sriov = cards.filter((d) => d.vgpu?.mode === 'sriov')
  for (const model of profileCapacity(sriov, allocations, catalog)) {
    const modelKey = model.key.toLowerCase()
    const rows = [...model.rows].sort((a, b) => seriesRank(a.name) - seriesRank(b.name) || a.fbMemory - b.fbMemory)
    for (const row of rows) {
      offers.push({
        kind: 'vgpu',
        modelKey,
        modelName: model.deviceName ?? '',
        profileName: row.name,
        fbMemory: row.fbMemory,
        freeNow: row.perCard.reduce((s, c) => s + c.free, 0),
      })
    }
  }

  const wholeModels = new Map<string, { name: string; free: number }>()
  for (const c of cards.filter((d) => d.vgpu?.mode !== 'sriov')) {
    const key = modelKeyOf(c)
    const m = wholeModels.get(key) ?? { name: c.deviceName ?? '', free: 0 }
    if (!allocations.some((a) => a.deviceKey === c.key)) m.free += 1
    wholeModels.set(key, m)
  }
  for (const [modelKey, m] of wholeModels) {
    offers.push({ kind: 'whole', modelKey, modelName: m.name, profileName: '', fbMemory: null, freeNow: m.free })
  }
  return offers
}

/** What the cards of one model add up to on a connection, to judge a contingent against. */
export type GpuModelCapacity = {
  modelKey: string
  modelName: string
  /** Frame buffer of the model's SR-IOV cards whose catalog was read, MiB. */
  fbTotal: number
  /** GPU cards of the model that are not in SR-IOV mode: those go whole to a VM. */
  wholeCards: number
  /** Some SR-IOV cards of the model were not read: fbTotal is short of the real total. */
  partial: boolean
}

/** Per card model of one connection, from the report and catalog already loaded. */
export function quotaCapacity(report: GpuReport, catalog: VisibleVgpuType[], connId: string): GpuModelCapacity[] {
  const cards = report.devices.filter((d) => d.kind === 'gpu' && d.connId === connId)
  const out = new Map<string, GpuModelCapacity>()
  const at = (modelKey: string, modelName: string) => {
    const cur = out.get(modelKey) ?? { modelKey, modelName, fbTotal: 0, wholeCards: 0, partial: false }
    out.set(modelKey, cur)
    return cur
  }
  const sriov = cards.filter((d) => d.vgpu?.mode === 'sriov')
  for (const model of profileCapacity(sriov, [], catalog)) {
    const cap = at(model.key.toLowerCase(), model.deviceName ?? '')
    cap.fbTotal += model.cards.reduce((s, c) => s + c.fbTotal, 0)
    if (model.unread.length > 0) cap.partial = true
  }
  for (const c of cards.filter((d) => d.vgpu?.mode !== 'sriov')) at(modelKeyOf(c), c.deviceName ?? '').wholeCards += 1
  return [...out.values()]
}
