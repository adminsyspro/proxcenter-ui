import { describe, expect, it } from 'vitest'

import { EXTRA_MOCKS } from './demo-api'

type DemoOverview = {
  data: {
    topCpuVms: Array<{ id: string; cpu: number; ram: number }>
    topRamVms: Array<{ ram: number }>
    storagePools: Array<{ daysToThreshold: number | null; growthPctPerDay: number | null }>
    clusters: Array<{ id: string; name: string; nodesTotal: number; nPlusOne: unknown }>
    nodes: Array<{ connectionId: string }>
  }
}

describe('demo resources overview', () => {
  const overview = EXTRA_MOCKS['GET:/api/v1/resources/overview'] as DemoOverview

  it('lists the top guests with the id the VM drawer opens, usage in percent', () => {
    const top = overview.data.topCpuVms

    expect(top.length).toBeGreaterThan(0)
    expect(top[0].id).toMatch(/^demo-pve-cluster-001:(qemu|lxc):[^:]+:\d+$/)
    for (const vm of [...top, ...overview.data.topRamVms]) expect(vm.ram).toBeGreaterThanOrEqual(0)
    expect(top.map(v => v.cpu)).toEqual([...top.map(v => v.cpu)].sort((a, b) => b - a))
  })

  it('builds the capacity model with the functions of the real overview', () => {
    const { clusters, nodes, storagePools } = overview.data

    expect(clusters).toHaveLength(1)
    expect(clusters[0]).toMatchObject({ id: 'demo-pve-cluster-001', name: 'Production Cluster' })
    expect(clusters[0].nPlusOne).toBeTruthy()
    expect(nodes.length).toBe(clusters[0].nodesTotal)
    // Sixty days of growth: every pool gets a growth rate.
    expect(storagePools.length).toBeGreaterThan(0)
    expect(storagePools.every(p => p.growthPctPerDay !== null)).toBe(true)
  })
})
