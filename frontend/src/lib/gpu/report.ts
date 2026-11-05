// Shapes the GPU snapshots of several connections for one caller (#672).
//
// Two scopes:
//  - infrastructure (provider, MSP on its own clusters, provider users with
//    restricted grants): the devices of the nodes the caller may view
//    (node.view), their allocation map and the capacity per node, per
//    cluster and in total. A VM the caller may not view (vm.view) still marks
//    its GPU as allocated, but its identity is withheld.
//  - tenant (vDC tenant): never the provider inventory. Only the GPUs held
//    by the tenant's own VMs (VMs in its vDC pools that it may view), without
//    PCI addresses, IOMMU groups, mapping names or capacity figures.
import type { ConnectionGpuSnapshot, GpuNodeState } from "./collect"
import { computeCapacity, type GpuCapacity, type GpuDevice, type GpuKind } from "./inventory"

export type GpuReportAllocation = {
  connId: string
  connectionName: string
  node: string
  /** null when the caller may not view the VM. */
  vmid: string | null
  vmName: string | null
  vmStatus: string | null
  template: boolean
  hidden: boolean
  hostpci: string | null
  via: "address" | "mapping"
  mapping: string | null
  mdev: string | null
  pooled: boolean
  /** Resource pool of the VM (null when hidden or in none). */
  pool: string | null
  /** Seconds since the VM started (null when stopped, hidden or unknown). */
  uptime: number | null
  /** SMBIOS UUID of the VM, how a vGPU host names it (null when hidden). */
  smbiosUuid: string | null
  /** The GPU is released but the running VM keeps it until it stops (null when hidden). */
  pendingRemoval: boolean
  kind: GpuKind
  vendorName: string | null
  deviceName: string | null
  /** PCI vendor and device IDs (0x10de, 0x2204): what the GPU is, not where it sits. */
  vendorId: string | null
  deviceId: string | null
  /** Device key and PCI address: infrastructure scope only. */
  deviceKey: string | null
  pciId: string | null
}

export type GpuReportDevice = GpuDevice & {
  connectionName: string
  vms: Array<{ vmid: string | null; vmName: string | null; vmStatus: string | null; hidden: boolean; template: boolean; hostpci: string | null; via: "address" | "mapping"; mdev: string | null; pooled: boolean }>
}

export type GpuReportNode = GpuNodeState & { connId: string; connectionName: string; capacity: GpuCapacity }

export type GpuReport = {
  scope: "infrastructure" | "tenant"
  generatedAt: string
  connections: Array<{ id: string; name: string; error: string | null; capacity: GpuCapacity | null }>
  nodes: GpuReportNode[]
  devices: GpuReportDevice[]
  allocations: GpuReportAllocation[]
  capacity: GpuCapacity | null
}

export type GpuVisibility = {
  /** vDC tenant: VM pools it owns per connection. null = not a vDC tenant. */
  tenantPools: Map<string, Set<string>> | null
  /** `${connId}:${node}` the caller may view; null = every node. */
  visibleNodes: Set<string> | null
  /** `${connId}:${node}:${vmid}` the caller may view; null = every VM. */
  visibleVms: Set<string> | null
  /** Restrict to one node (the node view of the inventory). */
  node?: string | null
}

export const vmVisibilityKey = (connId: string, node: string, vmid: string) => `${connId}:${node}:${vmid}`
export const nodeVisibilityKey = (connId: string, node: string) => `${connId}:${node}`

const EMPTY: GpuCapacity = { total: 0, allocated: 0, free: 0, inUse: 0, consoles: 0 }

function sumCapacity(list: GpuCapacity[]): GpuCapacity {
  return list.reduce(
    (acc, c) => ({
      total: acc.total + c.total,
      allocated: acc.allocated + c.allocated,
      free: acc.free + c.free,
      inUse: acc.inUse + c.inUse,
      consoles: acc.consoles + c.consoles,
    }),
    { ...EMPTY },
  )
}

export function buildGpuReport(snapshots: ConnectionGpuSnapshot[], vis: GpuVisibility): GpuReport {
  const generatedAt = snapshots.map((s) => s.generatedAt).sort((a, b) => a.localeCompare(b))[0] ?? new Date().toISOString()
  const nodeFilter = vis.node || null
  const vmVisible = (connId: string, node: string, vmid: string) =>
    !vis.visibleVms || vis.visibleVms.has(vmVisibilityKey(connId, node, vmid))

  if (vis.tenantPools) {
    const allocations: GpuReportAllocation[] = []
    for (const snap of snapshots) {
      const pools = vis.tenantPools.get(snap.connId)
      if (!pools) continue
      const devices = new Map(snap.devices.map((d) => [d.key, d]))
      for (const a of snap.allocations) {
        if (!a.pool || !pools.has(a.pool)) continue
        if (!vmVisible(a.connId, a.node, a.vmid)) continue
        if (nodeFilter && a.node !== nodeFilter) continue
        const d = devices.get(a.deviceKey)
        allocations.push({
          connId: snap.connId,
          connectionName: snap.connectionName,
          node: a.node,
          vmid: a.vmid,
          vmName: a.vmName,
          vmStatus: a.vmStatus,
          template: a.template,
          hidden: false,
          hostpci: a.hostpci,
          via: a.via,
          mapping: null,
          mdev: a.mdev,
          pooled: false,
          pool: a.pool,
          uptime: a.uptime,
          smbiosUuid: a.smbiosUuid ?? null,
          pendingRemoval: a.pendingRemoval === true,
          kind: d?.kind ?? "gpu",
          vendorName: d?.vendorName ?? null,
          deviceName: d?.deviceName ?? null,
          vendorId: d?.vendorId ?? null,
          deviceId: d?.deviceId ?? null,
          deviceKey: null,
          pciId: null,
        })
      }
    }
    return {
      scope: "tenant",
      generatedAt,
      connections: snapshots
        .filter((s) => vis.tenantPools!.has(s.connId))
        .map((s) => ({ id: s.connId, name: s.connectionName, error: null, capacity: null })),
      nodes: [],
      devices: [],
      allocations,
      capacity: null,
    }
  }

  const nodeVisible = (connId: string, node: string) =>
    (!nodeFilter || node === nodeFilter) && (!vis.visibleNodes || vis.visibleNodes.has(nodeVisibilityKey(connId, node)))

  const connections: GpuReport["connections"] = []
  const nodes: GpuReportNode[] = []
  const devices: GpuReportDevice[] = []
  const allocations: GpuReportAllocation[] = []

  for (const snap of snapshots) {
    const deviceByKey = new Map(snap.devices.map((d) => [d.key, d]))
    const visibleDevices = snap.devices.filter((d) => nodeVisible(d.connId, d.node))
    const visibleKeys = new Set(visibleDevices.map((d) => d.key))
    const connAllocations = snap.allocations.filter(
      (a) => visibleKeys.has(a.deviceKey) || (vmVisible(a.connId, a.node, a.vmid) && (!nodeFilter || a.node === nodeFilter)),
    )

    for (const a of connAllocations) {
      const d = deviceByKey.get(a.deviceKey)
      const shown = vmVisible(a.connId, a.node, a.vmid)
      allocations.push({
        connId: snap.connId,
        connectionName: snap.connectionName,
        node: a.node,
        vmid: shown ? a.vmid : null,
        vmName: shown ? a.vmName : null,
        vmStatus: shown ? a.vmStatus : null,
        template: shown ? a.template : false,
        hidden: !shown,
        hostpci: shown ? a.hostpci : null,
        via: a.via,
        mapping: a.mapping,
        mdev: a.mdev,
        pooled: a.pooled,
        pool: shown ? a.pool : null,
        uptime: shown ? a.uptime : null,
        smbiosUuid: shown ? (a.smbiosUuid ?? null) : null,
        pendingRemoval: shown && a.pendingRemoval === true,
        kind: d?.kind ?? "gpu",
        vendorName: d?.vendorName ?? null,
        deviceName: d?.deviceName ?? null,
        vendorId: d?.vendorId ?? null,
        deviceId: d?.deviceId ?? null,
        deviceKey: a.deviceKey,
        pciId: d?.id ?? null,
      })
    }

    for (const d of visibleDevices) {
      devices.push({
        ...d,
        connectionName: snap.connectionName,
        vms: allocations
          .filter((a) => a.deviceKey === d.key)
          .map((a) => ({
            vmid: a.vmid,
            vmName: a.vmName,
            vmStatus: a.vmStatus,
            hidden: a.hidden,
            template: a.template,
            hostpci: a.hostpci,
            via: a.via,
            mdev: a.mdev,
            pooled: a.pooled,
          })),
      })
    }

    const connNodes = snap.nodes.filter((n) => nodeVisible(snap.connId, n.node))
    const nodeCaps: GpuCapacity[] = []
    for (const n of connNodes) {
      const own = visibleDevices.filter((d) => d.node === n.node)
      const capacity = computeCapacity(own, snap.allocations)
      nodeCaps.push(capacity)
      nodes.push({ ...n, connId: snap.connId, connectionName: snap.connectionName, capacity })
    }
    // A connection the caller sees nothing of (no visible node) stays out of
    // the infrastructure view, unless it failed outright (the error is shown).
    if (connNodes.length || snap.error) {
      connections.push({ id: snap.connId, name: snap.connectionName, error: snap.error, capacity: sumCapacity(nodeCaps) })
    }
  }

  return {
    scope: "infrastructure",
    generatedAt,
    connections,
    nodes,
    devices,
    allocations,
    capacity: sumCapacity(connections.map((c) => c.capacity ?? EMPTY)),
  }
}
