import { describe, expect, it } from 'vitest'

import type { ClusterCapacity, NodeCapacity, StoragePool } from '../types'
import { DEFAULT_THRESHOLDS } from '../constants'
import {
  DEFAULT_ASSUMPTIONS,
  buildActionItems,
  computeClusterRunway,
  computeHeadroom,
  poolFromClusters,
  simulateScenario,
} from './capacityPlanning'

const GiB = 1024 ** 3

function node(name: string, overrides: Partial<NodeCapacity> = {}): NodeCapacity {
  return {
    key: `c1:${name}`, connectionId: 'c1', connectionName: 'Prod', node: name, online: true,
    cores: 32, cpuPct: 25, memTotal: 256 * GiB, memUsed: 128 * GiB, ramPct: 50,
    vcpuAllocated: 64, ramAllocated: 160 * GiB, guestsRunning: 10, guestsTotal: 12,
    ...overrides,
  }
}

function cluster(overrides: Partial<ClusterCapacity> = {}): ClusterCapacity {
  return {
    id: 'c1', name: 'Prod', nodesOnline: 2, nodesTotal: 2,
    cpu: { cores: 64, usedPct: 25, vcpuAllocated: 128, ratio: 2 },
    ram: { total: 512 * GiB, used: 256 * GiB, usedPct: 50, allocated: 320 * GiB, ratio: 0.63 },
    storage: { used: 10, total: 100, pct: 10 },
    guests: { running: 20, stopped: 4, templates: 1 },
    nPlusOne: { applicable: true, largestNode: 'pve1', cpuPctAfter: 50, ramPctAfter: 100, ok: false },
    imbalance: { cpu: 2, ram: 20 },
    trends: [],
    ...overrides,
  }
}

function pool(overrides: Partial<StoragePool> = {}): StoragePool {
  return {
    key: 'c1::ceph', name: 'ceph', type: 'rbd', shared: true, connectionId: 'c1', connectionName: 'Prod', node: null,
    used: 50, total: 100, pct: 50, growthPctPerDay: null, daysToThreshold: null,
    ...overrides,
  }
}

describe('computeHeadroom', () => {
  it('takes the tighter of RAM (to the warning threshold) and vCPU (to the accepted ratio)', () => {
    const pool = poolFromClusters([cluster()])
    const headroom = computeHeadroom(pool, DEFAULT_ASSUMPTIONS, DEFAULT_THRESHOLDS)

    // RAM: 512 × 80 % − 256 = 153.6 GiB → 19 VMs of 8 GiB. vCPU: 64 × 4 − 128 = 128 → 32 VMs of 4.
    expect(headroom).toEqual({ byRam: 19, byCpu: 32, count: 19, limitedBy: 'ram' })
  })

  it('never goes negative and is empty without capacity', () => {
    expect(computeHeadroom({ cores: 4, coresUsed: 4, vcpuAllocated: 100, ramTotal: GiB, ramUsed: 2 * GiB }, DEFAULT_ASSUMPTIONS, DEFAULT_THRESHOLDS))
      .toMatchObject({ byRam: 0, byCpu: 0, count: 0 })
    expect(computeHeadroom({ cores: 0, coresUsed: 0, vcpuAllocated: 0, ramTotal: 0, ramUsed: 0 }, DEFAULT_ASSUMPTIONS, DEFAULT_THRESHOLDS).limitedBy).toBeNull()
  })
})

describe('simulateScenario', () => {
  const nodes = [node('pve1'), node('pve2'), node('pve3', { online: false })]

  it('leaves the scope unchanged with an empty scenario', () => {
    const result = simulateScenario(nodes, { addVms: 0, loseLargestNode: false, addNodes: 0 }, DEFAULT_ASSUMPTIONS, DEFAULT_THRESHOLDS)

    expect(result).toMatchObject({ ramPct: 50, cpuPct: 25, vcpuRatio: 2, ramOk: true, cpuOk: true })
  })

  it('charges new VMs at full RAM and at the CPU the current guests draw per vCPU', () => {
    const result = simulateScenario(nodes, { addVms: 16, loseLargestNode: false, addNodes: 0 }, DEFAULT_ASSUMPTIONS, DEFAULT_THRESHOLDS)

    // + 128 GiB on 512 → 75 %. CPU: 16 cores used for 128 vCPU → 0.125 per vCPU, + 64 vCPU → + 8 cores → 24 / 64.
    expect(result).toMatchObject({ ramPct: 75, cpuPct: 37.5, vcpuRatio: 3 })
  })

  it('removes the largest node and adds copies of it', () => {
    expect(simulateScenario(nodes, { addVms: 0, loseLargestNode: true, addNodes: 0 }, DEFAULT_ASSUMPTIONS, DEFAULT_THRESHOLDS))
      .toMatchObject({ ramPct: 100, ramOk: false })
    expect(simulateScenario(nodes, { addVms: 0, loseLargestNode: true, addNodes: 1 }, DEFAULT_ASSUMPTIONS, DEFAULT_THRESHOLDS))
      .toMatchObject({ ramPct: 50, ramOk: true })
  })
})

describe('computeClusterRunway', () => {
  it('forecasts from the cluster history and keeps the soonest crossing', () => {
    const trends = Array.from({ length: 60 }, (_, i) => ({ t: `d${i}`, cpu: 20, ram: 60 + i * 0.4, storage: 10 }))
    const runway = computeClusterRunway(cluster({ ram: { ...cluster().ram, usedPct: 84 }, trends }), DEFAULT_THRESHOLDS, 180)

    expect(runway.soonest?.resource).toBe('ram')
    expect(runway.soonest?.daysToThreshold).toBeGreaterThan(0)
  })
})

describe('buildActionItems', () => {
  it('lists critical items first and points each one at the tab that explains it', () => {
    const items = buildActionItems({
      clusters: [cluster()],
      runways: [],
      nodes: [node('pve1'), node('pve9', { online: false })],
      pools: [pool({ key: 'a', pct: 95 }), pool({ key: 'b', pct: 60, daysToThreshold: 20 }), pool({ key: 'c', pct: 85, node: 'pve1', shared: false })],
      stopped: { count: 6, vcpu: 24, ramBytes: 96 * GiB, diskBytes: 0 },
      thresholds: DEFAULT_THRESHOLDS,
    })

    expect(items.map(i => [i.kind, i.severity])).toEqual([
      ['nPlusOne', 'critical'],
      ['nodeOffline', 'critical'],
      ['poolFull', 'critical'],
      ['imbalance', 'warning'],
      ['poolRunway', 'warning'],
      ['poolFull', 'warning'],
      ['dormant', 'info'],
    ])
    expect(items.find(i => i.kind === 'nPlusOne')?.tab).toBe('simulation')

    const empty = buildActionItems({
      clusters: [cluster({ nPlusOne: { applicable: true, largestNode: 'pve1', cpuPctAfter: null, ramPctAfter: 140, ok: false } })],
      runways: [],
      nodes: [],
      pools: [],
      stopped: null,
      thresholds: DEFAULT_THRESHOLDS,
    })
    // No "0 % CPU" when the remaining nodes have no capacity at all.
    expect(empty[0].kind).toBe('nPlusOneEmpty')
    expect(items.find(i => i.id === 'full:c')?.params.pool).toBe('ceph (pve1)')
  })

  it('points each item at the row that shows it', () => {
    const items = buildActionItems({
      clusters: [cluster()],
      runways: [{ clusterId: 'c1', soonest: null, alerts: [{ resource: 'ram', currentValue: 80, predictedValue: 90, daysToThreshold: 10, threshold: 90, trend: 'up', severity: 'critical' }] }],
      nodes: [node('pve9', { online: false })],
      pools: [pool({ key: 'a', pct: 95 })],
      stopped: { count: 6, vcpu: 24, ramBytes: 96 * GiB, diskBytes: 0 },
      thresholds: DEFAULT_THRESHOLDS,
    })
    const target = (kind: string) => items.find(i => i.kind === kind)?.target

    expect(target('runway')).toEqual({ section: 'clusters', key: 'c1' })
    expect(target('nPlusOne')).toEqual({ section: 'simulator', key: 'c1' })
    expect(target('imbalance')).toEqual({ section: 'nodes', key: 'c1' })
    expect(target('nodeOffline')).toEqual({ section: 'nodes', key: 'c1:pve9' })
    expect(target('poolFull')).toEqual({ section: 'pools', key: 'a' })
    expect(target('dormant')).toEqual({ section: 'efficiency' })
  })
})
