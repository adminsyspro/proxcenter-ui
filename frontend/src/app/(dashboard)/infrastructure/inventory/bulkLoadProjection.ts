// Load projection of a bulk migration on its target nodes (roadmap#53 part B),
// shown before the launch so the operator sees whether the nodes will hold
// the batch. Same model as the host-drain projection (#248, backend
// internal/drain/plan.go `project`): a target books each guest's configured
// memory (placement.GuestMemory) and its busy cores (placement.GuestBusyCores,
// usage x vCPUs) over the node's cores.
//
// A source VM has no Proxmox usage figure yet, and the source lists only give
// its size, so every vCPU is booked at BULK_PROJECTION_VCPU_LOAD: the upper
// bound of what the guest can bring, which is what "will the load hold" asks.

/** Busy share booked per vCPU of an incoming VM. */
export const BULK_PROJECTION_VCPU_LOAD = 1
/** Projected memory past this ratio of the node raises the (non-blocking) alert. */
export const BULK_PROJECTION_MEM_ALERT = 0.9

const MiB = 1024 * 1024

/** A target node as the node list route reports it (cpu is a 0..1 ratio). */
export interface ProjectionNodeStats {
  node: string
  cpu?: number
  maxcpu?: number
  mem?: number
  maxmem?: number
}

/** The size fields the source VM lists carry (VMware, XCP-ng, Hyper-V, Nutanix all normalise to `cpu` and `memory_size_MiB`). */
export interface ProjectionVm {
  cpu?: number | null
  num_cpu?: number | null
  cpuCount?: number | null
  memory_size_MiB?: number | null
  memoryMB?: number | null
}

export interface BulkNodeProjection {
  node: string
  /** False when the node list gave no capacity for this node: nothing to project against. */
  known: boolean
  mem_total: number
  mem_before: number
  mem_after: number
  cpu_before: number
  cpu_after: number
  cores: number
  guests_in: number
  vcpus_in: number
}

export function projectionVmVcpus(vm: ProjectionVm): number {
  const n = Number(vm.cpu ?? vm.num_cpu ?? vm.cpuCount)
  // Same floor as GuestBusyCores: a guest without a count takes one core.
  return Number.isFinite(n) && n > 0 ? n : 1
}

export function projectionVmMemoryBytes(vm: ProjectionVm): number {
  const mib = Number(vm.memory_size_MiB ?? vm.memoryMB)
  return Number.isFinite(mib) && mib > 0 ? mib * MiB : 0
}

/**
 * One row per target node, in the order of `targetNodes`. VM i goes to
 * targetNodes[i % targetNodes.length], the round-robin of the launch.
 */
export function bulkLoadProjection(vms: ProjectionVm[], targetNodes: string[], stats: ProjectionNodeStats[], nodeOf?: (vm: ProjectionVm, index: number) => string | null | undefined): BulkNodeProjection[] {
  if (targetNodes.length === 0) return []
  const rows = targetNodes.map((node): BulkNodeProjection => {
    const s = stats.find(x => x.node === node)
    const memTotal = Number(s?.maxmem) || 0
    const mem = Number(s?.mem) || 0
    const cpu = Number(s?.cpu) || 0
    const cores = Number(s?.maxcpu) > 0 ? Number(s?.maxcpu) : 1
    return {
      node, known: memTotal > 0, mem_total: memTotal, mem_before: mem, mem_after: mem,
      cpu_before: cpu, cpu_after: cpu, cores, guests_in: 0, vcpus_in: 0,
    }
  })
  // Two entries for one node (never expected) still book on a single row.
  const byNode = new Map<string, BulkNodeProjection>()
  for (const r of rows) if (!byNode.has(r.node)) byNode.set(r.node, r)
  vms.forEach((vm, i) => {
    // The split the launch uses: round-robin, or the copy-network placement on Auto.
    const r = byNode.get(nodeOf?.(vm, i) ?? targetNodes[i % targetNodes.length])
    if (!r) return
    const vcpus = projectionVmVcpus(vm)
    r.mem_after += projectionVmMemoryBytes(vm)
    r.cpu_after += (vcpus * BULK_PROJECTION_VCPU_LOAD) / r.cores
    r.guests_in++
    r.vcpus_in += vcpus
  })
  return [...byNode.values()]
}

/** Nodes whose projected memory passes BULK_PROJECTION_MEM_ALERT. */
export function bulkProjectionMemAlerts(rows: BulkNodeProjection[]): BulkNodeProjection[] {
  return rows.filter(r => r.known && r.mem_after / r.mem_total > BULK_PROJECTION_MEM_ALERT)
}
