// The GPUs of a vDC as its tenant sees them (#672). Built from the provider's
// infrastructure report, field by field: no node, card key, PCI address,
// mapping, connection or VM outside the pool ever reaches the tenant.
import type { VisibleGpuReading, VisibleVgpu } from './metricsShared'
import type { VdcGpuContext } from './vdcContext'
import { matchEntry, type GpuEntryKind, type PoolGpu } from './vdcQuota'

export type MyGpuLoad = { util: number; memUtil: number; fbUsed: number | null; fbTotal: number | null; at: string }

export type MyGpu = {
  hostpci: string
  kind: GpuEntryKind
  modelName: string
  profileName: string | null
  entryId: string | null
  pendingStart: boolean
  /** Released while the VM runs: the GPU goes at its next stop. */
  pendingRemoval: boolean
  load: MyGpuLoad | null
  licensed: boolean | null
}

export type MyGpuVm = { vmid: string; name: string; status: string; gpus: MyGpu[] }

export type MyGpuEntry = {
  id: string
  kind: GpuEntryKind
  modelName: string
  profileName: string
  fbMemory: number | null
  count: number
  used: number
  overCommitted: boolean
}

export type MyGpuView = { entries: MyGpuEntry[]; vms: MyGpuVm[]; measured: boolean; generatedAt: string }

const byVmid = (a: string, b: string) => Number(a) - Number(b) || a.localeCompare(b)
const byHostpci = (a: PoolGpu, b: PoolGpu) => a.hostpci.localeCompare(b.hostpci, undefined, { numeric: true })

/**
 * The host reading of a vGPU, tied to its VM through the SMBIOS UUID. A VM
 * with several vGPUs takes its readings in order, its own card first.
 */
function takeVgpuReading(readings: VisibleVgpu[], used: Set<VisibleVgpu>, g: PoolGpu): VisibleVgpu | null {
  const own = readings.filter((r) => r.vmid === g.vmid && !used.has(r))
  const hit = own.find((r) => r.deviceKey === g.deviceKey) ?? own[0] ?? null
  if (hit) used.add(hit)
  return hit
}

/** What the agent inside the VM reads of a whole card. */
const guestReading = (readings: VisibleGpuReading[], g: PoolGpu) =>
  readings.find((r) => r.source === 'guest' && r.vmid === g.vmid && r.deviceKey === g.deviceKey) ?? null

export function buildMyGpuView(ctx: VdcGpuContext, visibleVmids: Set<string> | null): MyGpuView {
  const measured = ctx.latest !== null
  const vgpuReadings = ctx.latest?.vgpus ?? []
  const guestReadings = ctx.latest?.gpus ?? []
  const hostRead = new Set(ctx.catalog.map((t) => t.deviceKey))
  const usedReadings = new Set<VisibleVgpu>()

  const entries: MyGpuEntry[] = ctx.entries.map((e) => {
    const used = ctx.usage.get(e.id) ?? 0
    const fbMemory = e.kind === 'vgpu' ? (ctx.catalog.find((t) => t.name === e.profileName)?.fbMemory ?? null) : null
    return { id: e.id, kind: e.kind, modelName: e.modelName, profileName: e.profileName, fbMemory, count: e.count, used, overCommitted: used > e.count }
  })

  const toGpu = (g: PoolGpu): MyGpu => {
    let load: MyGpuLoad | null = null
    let licensed: boolean | null = null
    let pendingStart = false
    if (g.kind === 'vgpu') {
      const r = takeVgpuReading(vgpuReadings, usedReadings, g)
      if (r) {
        load = { util: r.util, memUtil: r.memUtil, fbUsed: r.fbUsed, fbTotal: r.fbTotal, at: r.at }
        licensed = r.licensed
      }
      // The host of the card reports its vGPUs: a running VM it does not show
      // has not picked the profile up yet.
      pendingStart = measured && !r && g.vmStatus === 'running' && hostRead.has(g.deviceKey)
    } else {
      const r = guestReading(guestReadings, g)
      if (r) load = { util: r.util, memUtil: r.mem_util, fbUsed: r.mem_used, fbTotal: r.mem_total, at: r.at }
    }
    return {
      hostpci: g.hostpci,
      kind: g.kind,
      modelName: g.modelName,
      profileName: g.profileName,
      entryId: matchEntry(ctx.entries, g)?.id ?? null,
      pendingStart,
      pendingRemoval: g.pendingRemoval,
      load,
      licensed,
    }
  }

  const held = new Map<string, PoolGpu[]>()
  for (const g of ctx.gpus) {
    if (g.template || (visibleVmids && !visibleVmids.has(g.vmid))) continue
    held.set(g.vmid, [...(held.get(g.vmid) ?? []), g])
  }
  const vms: MyGpuVm[] = [...held.entries()]
    .sort(([a], [b]) => byVmid(a, b))
    .map(([vmid, gpus]) => ({
      vmid,
      name: gpus[0].vmName,
      status: gpus[0].vmStatus,
      gpus: [...gpus].sort(byHostpci).map(toGpu),
    }))

  return { entries, vms, measured, generatedAt: ctx.report.generatedAt }
}
