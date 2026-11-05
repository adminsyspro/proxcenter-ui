// Fleet-level reading of a GPU report (#672): what the GPU page shows on top
// of the inventory. Pure functions over the report the API already returns, so
// they cost no Proxmox call.
import type { GpuReport, GpuReportAllocation, GpuReportDevice } from './report'

export type GpuModelRow = {
  /** `${vendorId}:${deviceId}`, or the device name when the IDs are missing. */
  key: string
  vendorName: string | null
  deviceName: string | null
  vendorId: string | null
  deviceId: string | null
  total: number
  allocated: number
  free: number
  inUse: number
  /** Names of the clusters holding this model. */
  clusters: string[]
}

export type GpuHolder = GpuReportDevice['vms'][number]

/** A GPU referenced by several VMs that could run: only one of them can start. */
export type GpuContention = {
  device: GpuReportDevice
  holders: GpuHolder[]
  running: GpuHolder | null
}

export type GpuWorkload = {
  /** `${connId}:${node}:${vmid}` */
  key: string
  connId: string
  connectionName: string
  node: string
  vmid: string
  vmName: string | null
  vmStatus: string | null
  template: boolean
  pool: string | null
  uptime: number | null
  gpus: GpuReportAllocation[]
  /** Why one of its whole cards cannot be counted on, null when nothing stands in the way. */
  conflict: GpuConflict | null
}

/**
 * A whole card a VM cannot count on: also given to other VMs (only one of
 * them can start with it), or shared out as vGPUs (no VM can have it whole).
 * `others` names the other holders the caller may see.
 */
export type GpuConflict = { kind: 'shared'; others: string[] } | { kind: 'vgpuMode' }

// What the page flags at the top. A GPU held by several VMs or by a stopped VM
// is not flagged there (the Workloads tab shows both per VM).
export type GpuAttention =
  | { kind: 'notIsolated'; key: string; device: GpuReportDevice }
  | { kind: 'nodeError'; key: string; connectionName: string; node: string; error: string }
  | { kind: 'connectionError'; key: string; connectionName: string; error: string }

/** Identity of a GPU model across clusters: its PCI IDs, or its name when PVE gives none. */
export const modelKey = (d: { vendorId: string | null; deviceId: string | null; deviceName: string | null }) =>
  d.vendorId && d.deviceId ? `${d.vendorId}:${d.deviceId}` : `name:${d.deviceName ?? '?'}`

const isRunning = (status: string | null) => status === 'running'

/** Allocatable GPUs grouped by model, the question a capacity planner asks first. */
export function modelBreakdown(report: GpuReport): GpuModelRow[] {
  const rows = new Map<string, GpuModelRow & { clusterSet: Set<string> }>()
  for (const d of report.devices) {
    if (d.kind !== 'gpu') continue
    const key = modelKey(d)
    let row = rows.get(key)
    if (!row) {
      row = {
        key,
        vendorName: d.vendorName,
        deviceName: d.deviceName,
        vendorId: d.vendorId,
        deviceId: d.deviceId,
        total: 0,
        allocated: 0,
        free: 0,
        inUse: 0,
        clusters: [],
        clusterSet: new Set(),
      }
      rows.set(key, row)
    }
    row.total++
    if (d.vms.length) row.allocated++
    else row.free++
    if (d.vms.some((v) => isRunning(v.vmStatus))) row.inUse++
    row.clusterSet.add(d.connectionName)
  }
  return [...rows.values()]
    .map(({ clusterSet, ...row }) => ({ ...row, clusters: [...clusterSet].sort((a, b) => a.localeCompare(b)) }))
    .sort((a, b) => b.total - a.total || (a.deviceName ?? '').localeCompare(b.deviceName ?? ''))
}

/**
 * GPUs that several VMs reference by address or by a single-device mapping.
 * Templates never start and a pooled mapping lets PVE pick a free device, so
 * neither counts.
 */
export function contentions(report: GpuReport): GpuContention[] {
  const out: GpuContention[] = []
  for (const d of report.devices) {
    if (d.kind !== 'gpu') continue
    // vGPUs share their card by design; a whole-card passthrough conflicts
    // with another one, and with a card that is in vGPU mode.
    const holders = d.vms.filter((v) => !v.template && !v.pooled && !v.mdev)
    if (holders.length < 2 && !(holders.length === 1 && d.vgpu?.mode === 'sriov')) continue
    out.push({ device: d, holders, running: holders.find((v) => isRunning(v.vmStatus)) ?? null })
  }
  return out
}

const workloadKey = (connId: string, node: string, vmid: string) => `${connId}:${node}:${vmid}`

/**
 * One row per VM holding at least one GPU, running ones first. Hidden VMs are
 * left out, and so are the console controllers a VM may pass through: they
 * are not GPU capacity.
 */
export function workloads(report: GpuReport): GpuWorkload[] {
  const contended = new Map(contentions(report).map((c) => [c.device.key, c]))

  const rows = new Map<string, GpuWorkload>()
  for (const a of report.allocations) {
    if (a.hidden || !a.vmid || a.kind !== 'gpu') continue
    const key = workloadKey(a.connId, a.node, a.vmid)
    let row = rows.get(key)
    if (!row) {
      row = {
        key,
        connId: a.connId,
        connectionName: a.connectionName,
        node: a.node,
        vmid: a.vmid,
        vmName: a.vmName,
        vmStatus: a.vmStatus,
        template: a.template,
        pool: a.pool,
        uptime: a.uptime,
        gpus: [],
        conflict: null,
      }
      rows.set(key, row)
    }
    row.gpus.push(a)
    // A vGPU shares its card by design: only a whole-card holder is in conflict.
    const c = a.deviceKey && !a.template && !a.pooled && !a.mdev ? contended.get(a.deviceKey) : undefined
    if (c && !row.conflict) {
      row.conflict =
        c.device.vgpu?.mode === 'sriov'
          ? { kind: 'vgpuMode' }
          : {
              kind: 'shared',
              others: c.holders.filter((h) => h.vmid !== a.vmid && !h.hidden).map((h) => `${h.vmName ?? ''} #${h.vmid}`.trim()),
            }
    }
  }
  const rank = (w: GpuWorkload) => (isRunning(w.vmStatus) ? 0 : w.template ? 2 : 1)
  return [...rows.values()].sort(
    (a, b) => rank(a) - rank(b) || (a.vmName ?? '').localeCompare(b.vmName ?? '') || Number(a.vmid) - Number(b.vmid),
  )
}

/** What an administrator should look at, worst first. */
export function attentionItems(report: GpuReport): GpuAttention[] {
  const items: GpuAttention[] = []
  for (const c of report.connections) {
    if (c.error) items.push({ kind: 'connectionError', key: `conn:${c.id}`, connectionName: c.name, error: c.error })
  }
  for (const n of report.nodes) {
    if (n.error) items.push({ kind: 'nodeError', key: `node:${n.connId}:${n.node}`, connectionName: n.connectionName, node: n.node, error: n.error })
  }
  for (const d of report.devices) {
    if (d.kind === 'gpu' && !d.iommuIsolated) items.push({ kind: 'notIsolated', key: `iommu:${d.key}`, device: d })
  }
  return items
}

/** The attention items grouped by kind, for the strip of chips at the top of the page. */
export function attentionByKind(items: GpuAttention[]): Array<{ kind: GpuAttention['kind']; items: GpuAttention[] }> {
  const order: Array<GpuAttention['kind']> = ['connectionError', 'nodeError', 'notIsolated']
  return order.map((kind) => ({ kind, items: items.filter((i) => i.kind === kind) })).filter((g) => g.items.length > 0)
}

export type FleetScope = { connId?: string | null; node?: string | null }

/** The report narrowed to one cluster, or one node of it (the filters of the GPU page). */
export function scopeReport(report: GpuReport, scope: FleetScope): GpuReport {
  if (!scope.connId && !scope.node) return report
  const inScope = (connId: string, node: string | null) => (!scope.connId || connId === scope.connId) && (!scope.node || node === scope.node)
  return {
    ...report,
    connections: report.connections.filter((c) => !scope.connId || c.id === scope.connId),
    nodes: report.nodes.filter((n) => inScope(n.connId, n.node)),
    devices: report.devices.filter((d) => inScope(d.connId, d.node)),
    allocations: report.allocations.filter((a) => inScope(a.connId, a.node)),
  }
}
