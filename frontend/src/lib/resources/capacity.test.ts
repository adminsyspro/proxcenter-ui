import { describe, expect, it } from 'vitest'

import {
  buildClusterCapacity,
  buildNodeCapacities,
  buildStoragePools,
  clusterKpis,
  computeNPlusOne,
  computeStoppedAllocation,
  standardDeviation,
  storageEntryKey,
  storageGrowth,
  sumPools,
  type ConnectionSnapshot,
  type Thresholds,
} from './capacity'

const GiB = 1024 ** 3
const TiB = 1024 ** 4

const thresholds: Thresholds = {
  cpu: { warning: 80, critical: 90 },
  ram: { warning: 80, critical: 90 },
  storage: { warning: 80, critical: 90 },
}

function snapshot(overrides: Partial<ConnectionSnapshot> = {}): ConnectionSnapshot {
  return {
    id: 'c1',
    name: 'Prod',
    nodes: [
      { node: 'pve1', status: 'online', cpu: 0.5, maxcpu: 32, mem: 64 * GiB, maxmem: 128 * GiB },
      { node: 'pve2', status: 'online', cpu: 0.3, maxcpu: 32, mem: 32 * GiB, maxmem: 128 * GiB },
      { node: 'pve3', status: 'offline', maxcpu: 32, maxmem: 128 * GiB },
    ],
    guests: [
      { vmid: 100, node: 'pve1', type: 'qemu', status: 'running', maxcpu: 8, maxmem: 16 * GiB, maxdisk: 100 * GiB },
      { vmid: 101, node: 'pve1', type: 'qemu', status: 'stopped', maxcpu: 4, maxmem: 8 * GiB, maxdisk: 50 * GiB },
      { vmid: 102, node: 'pve2', type: 'lxc', status: 'running', maxcpu: 2, maxmem: 4 * GiB, maxdisk: 8 * GiB },
      { vmid: 9000, node: 'pve2', type: 'qemu', status: 'stopped', template: 1, maxcpu: 2, maxmem: 2 * GiB, maxdisk: 20 * GiB },
    ],
    storages: [],
    ...overrides,
  }
}

describe('buildNodeCapacities', () => {
  it('keys nodes by connection and counts only running, non-template guests as allocated', () => {
    const nodes = buildNodeCapacities(snapshot())

    expect(nodes.map(n => n.key)).toEqual(['c1:pve1', 'c1:pve2', 'c1:pve3'])
    expect(nodes[0]).toMatchObject({ online: true, cpuPct: 50, ramPct: 50, vcpuAllocated: 8, ramAllocated: 16 * GiB, guestsRunning: 1, guestsTotal: 2 })
    expect(nodes[1]).toMatchObject({ vcpuAllocated: 2, guestsRunning: 1, guestsTotal: 1 })
    expect(nodes[2]).toMatchObject({ online: false, cpuPct: 0, ramPct: 0, memUsed: 0 })
  })
})

describe('computeNPlusOne', () => {
  it('is not applicable with a single online node', () => {
    const nodes = buildNodeCapacities(snapshot({ nodes: [{ node: 'pve1', status: 'online', cpu: 0.1, maxcpu: 8, mem: GiB, maxmem: 8 * GiB }] }))

    expect(computeNPlusOne(nodes, thresholds)).toEqual({ applicable: false, largestNode: null, cpuPctAfter: null, ramPctAfter: null, ok: null })
  })

  it('reports the load the survivors would carry after losing the largest node', () => {
    const result = computeNPlusOne(buildNodeCapacities(snapshot()), thresholds)

    // 96 GiB used on 256 GiB online; lose 128 GiB → 75 %. CPU 16 + 9.6 cores on 32 → 80 %.
    expect(result).toEqual({ applicable: true, largestNode: 'pve1', cpuPctAfter: 80, ramPctAfter: 75, ok: true })
  })

  it('fails when the survivors would go over the critical threshold', () => {
    const nodes = buildNodeCapacities(snapshot({
      nodes: [
        { node: 'a', status: 'online', cpu: 0.2, maxcpu: 16, mem: 100 * GiB, maxmem: 128 * GiB },
        { node: 'b', status: 'online', cpu: 0.2, maxcpu: 16, mem: 100 * GiB, maxmem: 128 * GiB },
      ],
    }))

    expect(computeNPlusOne(nodes, thresholds)).toMatchObject({ ok: false, ramPctAfter: 156.3 })
  })
})

describe('computeStoppedAllocation', () => {
  it('sums what stopped guests reserve and leaves templates out', () => {
    expect(computeStoppedAllocation(snapshot().guests)).toEqual({ count: 1, vcpu: 4, ramBytes: 8 * GiB, diskBytes: 50 * GiB })
  })
})

describe('standardDeviation', () => {
  it('is zero below two values and rounds to one decimal', () => {
    expect(standardDeviation([42])).toBe(0)
    expect(standardDeviation([10, 20, 30])).toBe(8.2)
  })
})

describe('buildStoragePools', () => {
  const storages = [
    { storage: 'ceph', node: 'pve1', status: 'available', shared: 1, disk: 4 * TiB, maxdisk: 10 * TiB, plugintype: 'rbd' },
    { storage: 'ceph', node: 'pve2', status: 'available', shared: 1, disk: 4 * TiB, maxdisk: 10 * TiB, plugintype: 'rbd' },
    { storage: 'local', node: 'pve1', status: 'available', shared: 0, disk: 50 * GiB, maxdisk: 100 * GiB, plugintype: 'dir' },
    { storage: 'local', node: 'pve2', status: 'available', shared: 0, disk: 95 * GiB, maxdisk: 100 * GiB, plugintype: 'dir' },
    { storage: 'nfs', node: 'pve1', status: 'unknown', shared: 1, disk: 1, maxdisk: 2 },
  ]

  it('counts a shared storage once per cluster and a local one once per node', () => {
    const pools = buildStoragePools([snapshot({ storages })], new Map(), thresholds)

    expect(pools.map(p => p.key)).toEqual(['c1:pve2:local', 'c1:pve1:local', 'c1::ceph'])
    expect(pools.find(p => p.key === 'c1::ceph')).toMatchObject({ shared: true, node: null, used: 4 * TiB, total: 10 * TiB, pct: 40 })
    expect(sumPools(pools)).toEqual({ used: 4 * TiB + 145 * GiB, total: 10 * TiB + 200 * GiB })
  })

  it('keeps two clusters apart even when their storages share a name', () => {
    const pools = buildStoragePools([snapshot({ storages }), snapshot({ id: 'c2', name: 'DR', storages })], new Map(), thresholds)

    expect(pools.filter(p => p.name === 'ceph').map(p => p.connectionId).sort()).toEqual(['c1', 'c2'])
  })

  it('takes the history of any node for a shared pool', () => {
    const series = new Map(Array.from({ length: 30 }, (_, i) => [`2026-10-${String(i + 1).padStart(2, '0')}`, 30 + i * 0.5]))
    const daily = new Map([[storageEntryKey('c1', 'pve2', 'ceph'), series]])
    const pool = buildStoragePools([snapshot({ storages })], daily, thresholds).find(p => p.key === 'c1::ceph')!

    expect(pool.growthPctPerDay).toBe(0.5)
    // 40 % today, + 0.5 point a day, critical at 90 % → 100 days.
    expect(pool.daysToThreshold).toBe(100)
  })
})

describe('storageGrowth', () => {
  it('needs a week of history and says 0 days when the pool is already over', () => {
    expect(storageGrowth(new Map([['2026-10-01', 50]]), 50, 90)).toEqual({ growthPctPerDay: null, daysToThreshold: null })
    expect(storageGrowth(undefined, 95, 90)).toEqual({ growthPctPerDay: null, daysToThreshold: 0 })
  })
})

describe('buildClusterCapacity', () => {
  it('rolls nodes, guests and the cluster pools up', () => {
    const snap = snapshot({ storages: [{ storage: 'ceph', node: 'pve1', status: 'available', shared: 1, disk: TiB, maxdisk: 4 * TiB }] })
    const nodes = buildNodeCapacities(snap)
    const pools = buildStoragePools([snap], new Map(), thresholds)
    const cluster = buildClusterCapacity(snap, nodes, pools, thresholds, [])

    expect(cluster).toMatchObject({
      id: 'c1',
      nodesOnline: 2,
      nodesTotal: 3,
      cpu: { cores: 64, usedPct: 40, vcpuAllocated: 10, ratio: 0.16 },
      ram: { total: 256 * GiB, used: 96 * GiB, usedPct: 37.5, allocated: 20 * GiB },
      storage: { used: TiB, total: 4 * TiB, pct: 25 },
      guests: { running: 2, stopped: 1, templates: 1 },
      imbalance: { cpu: 10, ram: 12.5 },
    })
    expect(cluster.nPlusOne.applicable).toBe(true)
  })
})

describe('clusterKpis', () => {
  const GiB = 1024 ** 3
  const base = {
    id: 'c', name: 'C', nodesOnline: 2, nodesTotal: 2,
    cpu: { cores: 32, usedPct: 10, vcpuAllocated: 64, ratio: 2 },
    ram: { total: 128 * GiB, used: 64 * GiB, usedPct: 50, allocated: 96 * GiB, ratio: 0.75 },
    storage: { used: 40, total: 100, pct: 40 },
    guests: { running: 12, stopped: 3, templates: 2 },
    nPlusOne: { applicable: true, largestNode: 'a', cpuPctAfter: 20, ramPctAfter: 100, ok: false },
    imbalance: { cpu: 1, ram: 2 },
    trends: [],
  }

  it('works out the score inputs as the single-cluster view does', () => {
    const kpis = clusterKpis(base)

    expect(kpis.cpu).toEqual({ used: 10, allocated: 64, total: 32, trend: 0 })
    expect(kpis.storage).toEqual({ used: 40, total: 100, trend: 0 })
    expect(kpis.vms).toEqual({ total: 15, running: 12, stopped: 3 })
    // CPU: 10 % used of 200 % allocated -> 5 ; RAM: 50 % of 75 % -> 66.7 ; mean 35.8
    expect(kpis.efficiency).toBe(36)
  })

  it('counts an empty allocation as fully efficient', () => {
    const kpis = clusterKpis({ ...base, cpu: { ...base.cpu, vcpuAllocated: 0 }, ram: { ...base.ram, allocated: 0 } })

    expect(kpis.efficiency).toBe(100)
  })
})
