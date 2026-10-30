/**
 * get_capacity: over-commitment and headroom per host and per cluster (#459).
 *
 * Computed from the snapshot alone, so it costs no Proxmox call. Answers the
 * sizing questions an admin asks before placing load: "how over-committed is
 * the CPU?", "can I add five VMs of 8 GB?", "does the cluster survive the loss
 * of a host?".
 */

import { argNumber, argString, resolveConnection, type CatalogTool } from './types'
import type { SnapshotGuest, SnapshotNode } from './snapshot'

/** RAM kept back on every host for the host itself, ZFS ARC and spikes. */
export const HOST_RAM_RESERVE_PCT = 10

const r1 = (v: number) => Math.round(v * 10) / 10

const ratio = (assigned: number, physical: number | undefined) => (physical && physical > 0 ? r1(assigned / physical) : null)

function nodeCapacity(node: SnapshotNode, guests: SnapshotGuest[], vmMemoryGb?: number) {
  const running = guests.filter(g => g.status === 'running' && !g.template)
  const vcpusRunning = running.reduce((sum, g) => sum + (g.vcpus ?? 0), 0)
  const vcpusAll = guests.filter(g => !g.template).reduce((sum, g) => sum + (g.vcpus ?? 0), 0)
  const memAssignedRunning = running.reduce((sum, g) => sum + g.memTotalGb, 0)
  const reserve = (node.memTotalGb * HOST_RAM_RESERVE_PCT) / 100
  const usableFree = Math.max(0, node.memTotalGb - node.memUsedGb - reserve)
  const fits = vmMemoryGb && node.status === 'online' ? Math.floor(usableFree / vmMemoryGb) : 0

  return {
    node: node.name,
    cluster: node.cluster,
    online: node.status === 'online',
    cores: node.cores ?? null,
    vcpusAssignedRunning: vcpusRunning,
    vcpusAssignedAll: vcpusAll,
    cpuOvercommit: ratio(vcpusRunning, node.cores),
    memoryTotalGb: node.memTotalGb,
    memoryUsedGb: node.memUsedGb,
    memoryAssignedRunningGb: r1(memAssignedRunning),
    memoryOvercommit: ratio(memAssignedRunning, node.memTotalGb),
    // Spelled out: a 9B model read 0.6 as "heavily over-committed".
    memoryOvercommitted: memAssignedRunning > node.memTotalGb,
    memoryFreeAfterReserveGb: r1(usableFree),
    ...(vmMemoryGb ? { fitsVmsOfThatSize: fits } : {}),
  }
}

export const getCapacityTool: CatalogTool = {
  name: 'get_capacity',
  readOnly: true,
  description:
    'Capacity and over-commitment per host and per cluster: vCPUs assigned per physical core, RAM assigned versus installed, free RAM after a 10 % host reserve, whether the cluster can absorb the loss of its biggest host, and optionally how many new VMs of a given size still fit. Answers "how over-committed is my CPU?", "can I add 5 VMs of 8 GB?", "do we survive losing a host?". Example: vm_memory_gb=8',
  parameters: {
    type: 'object',
    properties: {
      cluster: { type: 'string', description: 'Cluster name, only when the user names one.' },
      vm_memory_gb: { type: 'number', description: 'RAM of the VM the user plans to add, in GB, to count how many fit.' },
    },
  },
  async execute(args, ctx) {
    const clusterRef = argString(args, 'cluster')
    const vmMemoryGb = args.vm_memory_gb === undefined || args.vm_memory_gb === null || args.vm_memory_gb === ''
      ? undefined
      : argNumber(args, 'vm_memory_gb', 8, { min: 0.25, max: 4096 })
    const connections = clusterRef ? [resolveConnection(ctx, clusterRef)] : ctx.snapshot.clusters.map(c => ({ id: c.id, name: c.name }))

    const clusters = connections.map(connection => {
      const nodes = ctx.snapshot.nodes.filter(n => n.connId === connection.id)
      const perNode = nodes.map(node =>
        nodeCapacity(node, ctx.snapshot.guests.filter(g => g.connId === connection.id && g.node === node.name), vmMemoryGb)
      )
      const online = perNode.filter(n => n.online)
      const cores = online.reduce((sum, n) => sum + (n.cores ?? 0), 0)
      const vcpus = online.reduce((sum, n) => sum + n.vcpusAssignedRunning, 0)
      const memTotal = online.reduce((sum, n) => sum + n.memoryTotalGb, 0)
      const memAssigned = online.reduce((sum, n) => sum + n.memoryAssignedRunningGb, 0)

      // N+1: the RAM used on the busiest host must fit in what the others
      // still have free. HA restarts its guests there, nowhere else.
      const busiest = [...online].sort((a, b) => b.memoryUsedGb - a.memoryUsedGb)[0]
      const freeElsewhere = online.filter(n => n !== busiest).reduce((sum, n) => sum + n.memoryFreeAfterReserveGb, 0)
      const fitsOf = (hosts: typeof online) => hosts.reduce((sum, n) => sum + (n.fitsVmsOfThatSize ?? 0), 0)

      return {
        cluster: connection.name,
        hostsOnline: online.length,
        hostsTotal: perNode.length,
        cpuOvercommit: ratio(vcpus, cores),
        memoryOvercommit: ratio(memAssigned, memTotal),
        memoryOvercommitted: memAssigned > memTotal,
        memoryFreeAfterReserveGb: r1(online.reduce((sum, n) => sum + n.memoryFreeAfterReserveGb, 0)),
        survivesLosingBusiestHost:
          online.length > 1 && busiest ? { host: busiest.node, ok: freeElsewhere >= busiest.memoryUsedGb, ramToRehomeGb: busiest.memoryUsedGb, freeOnOthersGb: r1(freeElsewhere) } : null,
        ...(vmMemoryGb
          ? {
              fitsVmsOfThatSize: fitsOf(online),
              // With no busiest host the cluster has none online: nothing fits.
              fitsVmsKeepingOneHostSpare: fitsOf(online.filter(n => n !== busiest)),
            }
          : {}),
        hosts: perNode,
      }
    })

    return {
      hostRamReservePct: HOST_RAM_RESERVE_PCT,
      ...(vmMemoryGb ? { vmMemoryGb } : {}),
      clusters,
      note: 'An over-commit ratio is assigned divided by physical: BELOW 1 means NOT over-committed (0.6 = 60 % of the RAM is assigned). It counts running guests only. CPU over-commit of 2 to 4 is common; RAM over-commit above 1 relies on ballooning or KSM.',
    }
  },
}
