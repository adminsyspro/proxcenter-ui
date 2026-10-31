import { describe, it, expect } from 'vitest'

import { getCapacityTool, HOST_RAM_RESERVE_PCT } from './capacity'
import type { SnapshotGuest, SnapshotNode } from './snapshot'
import type { ToolContext } from './types'

const node = (name: string, memUsedGb: number, over: Partial<SnapshotNode> = {}): SnapshotNode => ({
  connId: 'c1', cluster: 'PVE-PROD', name, status: 'online', cpuPct: 5, cores: 8, memPct: 0, memUsedGb, memTotalGb: 32, ...over,
})

const guest = (vmid: string, nodeName: string, vcpus: number, memTotalGb: number, over: Partial<SnapshotGuest> = {}): SnapshotGuest => ({
  connId: 'c1', cluster: 'PVE-PROD', vmid, name: `vm-${vmid}`, type: 'VM', kind: 'qemu', status: 'running', node: nodeName,
  cpuPct: 1, vcpus, memPct: 1, memUsedGb: 1, memTotalGb, template: false, ...over,
})

const ctx = (nodes: SnapshotNode[], guests: SnapshotGuest[]): ToolContext => ({
  snapshot: {
    clusters: [{ id: 'c1', name: 'PVE-PROD', nodeCount: nodes.length, guestCount: guests.length }],
    nodes,
    guests,
    summary: { totalGuests: guests.length, runningGuests: 0, stoppedGuests: 0, totalNodes: nodes.length, onlineNodes: nodes.length },
    cached: false,
  },
  tenantId: 't',
  locale: 'en',
})

describe('get_capacity', () => {
  const nodes = [node('pve1', 10), node('pve2', 20), node('pve3', 4)]
  const guests = [
    guest('1', 'pve1', 8, 16),
    guest('2', 'pve1', 8, 16),
    guest('3', 'pve2', 4, 8),
    guest('4', 'pve2', 4, 8, { status: 'stopped' }),
    guest('5', 'pve3', 2, 4, { template: true, status: 'stopped' }),
  ]

  it('computes over-commit from running guests per host and per cluster', async () => {
    const res = (await getCapacityTool.execute({}, ctx(nodes, guests))) as any
    const cluster = res.clusters[0]
    const pve1 = cluster.hosts.find((h: any) => h.node === 'pve1')

    expect(pve1).toMatchObject({ vcpusAssignedRunning: 16, cpuOvercommit: 2, memoryAssignedRunningGb: 32, memoryOvercommit: 1, memoryOvercommitted: false })
    // The stopped guest counts in "all", not in the running over-commit; a template counts nowhere.
    expect(cluster.hosts.find((h: any) => h.node === 'pve2')).toMatchObject({ vcpusAssignedRunning: 4, vcpusAssignedAll: 8 })
    expect(cluster.hosts.find((h: any) => h.node === 'pve3').vcpusAssignedAll).toBe(0)
    expect(cluster).toMatchObject({ hostsOnline: 3, cpuOvercommit: 0.8, memoryOvercommitted: false })
  })

  it('keeps a host reserve and counts the VMs of a size that still fit', async () => {
    const res = (await getCapacityTool.execute({ vm_memory_gb: 8 }, ctx(nodes, guests))) as any
    const cluster = res.clusters[0]
    const reserve = (32 * HOST_RAM_RESERVE_PCT) / 100

    expect(cluster.hosts.find((h: any) => h.node === 'pve1').memoryFreeAfterReserveGb).toBe(32 - 10 - reserve)
    // pve1 18.8 -> 2, pve2 8.8 -> 1, pve3 24.8 -> 3.
    expect(cluster.fitsVmsOfThatSize).toBe(6)
    // Keeping the busiest host (pve2) spare.
    expect(cluster.fitsVmsKeepingOneHostSpare).toBe(5)
  })

  it('says whether the cluster absorbs the loss of its busiest host', async () => {
    const ok = (await getCapacityTool.execute({}, ctx(nodes, guests))) as any

    expect(ok.clusters[0].survivesLosingBusiestHost).toEqual({ host: 'pve2', ok: true, ramToRehomeGb: 20, freeOnOthersGb: 43.6 })

    const tight = (await getCapacityTool.execute({}, ctx([node('a', 28), node('b', 28)], []))) as any

    expect(tight.clusters[0].survivesLosingBusiestHost.ok).toBe(false)
  })

  it('leaves an offline host out of what is free', async () => {
    const res = (await getCapacityTool.execute({ vm_memory_gb: 8 }, ctx([node('pve1', 0), node('pve2', 0, { status: 'offline' })], []))) as any

    expect(res.clusters[0]).toMatchObject({ hostsOnline: 1, hostsTotal: 2, fitsVmsOfThatSize: 3, survivesLosingBusiestHost: null })
  })
})
