import { describe, expect, it } from 'vitest'

import { bulkLoadProjection, bulkProjectionMemAlerts, projectionVmMemoryBytes, projectionVmVcpus } from './bulkLoadProjection'

const GiB = 1024 ** 3

describe('bulkLoadProjection', () => {
  const stats = [
    { node: 'pve1', cpu: 0.2, maxcpu: 16, mem: 32 * GiB, maxmem: 64 * GiB },
    { node: 'pve2', cpu: 0.5, maxcpu: 8, mem: 10 * GiB, maxmem: 32 * GiB },
  ]

  it('spreads the VMs round-robin like the launch and books memory and busy cores on each target', () => {
    const vms = [
      { cpu: 4, memory_size_MiB: 8192 },
      { cpu: 2, memory_size_MiB: 4096 },
      { cpu: 4, memory_size_MiB: 8192 },
    ]
    const rows = bulkLoadProjection(vms, ['pve1', 'pve2'], stats)
    expect(rows.map(r => r.node)).toEqual(['pve1', 'pve2'])
    expect(rows[0]).toMatchObject({ known: true, mem_total: 64 * GiB, mem_before: 32 * GiB, mem_after: 48 * GiB, cpu_before: 0.2, guests_in: 2, vcpus_in: 8 })
    expect(rows[0].cpu_after).toBeCloseTo(0.2 + 8 / 16)
    expect(rows[1]).toMatchObject({ mem_after: 14 * GiB, guests_in: 1, vcpus_in: 2 })
    expect(rows[1].cpu_after).toBeCloseTo(0.5 + 2 / 8)
  })

  it('sends every VM to a single chosen node', () => {
    const rows = bulkLoadProjection([{ cpu: 1, memory_size_MiB: 1024 }, { cpu: 1, memory_size_MiB: 1024 }], ['pve2'], stats)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ node: 'pve2', guests_in: 2, mem_after: 12 * GiB })
  })

  it('marks a node without a reported capacity as unknown', () => {
    const rows = bulkLoadProjection([{ cpu: 2 }], ['pve9'], stats)
    expect(rows[0]).toMatchObject({ node: 'pve9', known: false, guests_in: 1, cores: 1 })
  })

  it('returns nothing without a target', () => {
    expect(bulkLoadProjection([{ cpu: 2 }], [], stats)).toEqual([])
  })

  it('flags the nodes whose projected memory passes 90 %', () => {
    const rows = bulkLoadProjection([{ cpu: 2, memory_size_MiB: 20 * 1024 }, { cpu: 2, memory_size_MiB: 1024 }], ['pve1', 'pve2'], stats)
    // pve1: 32 + 20 = 52 of 64 GiB (81 %); pve2: 10 + 1 = 11 of 32 GiB.
    expect(bulkProjectionMemAlerts(rows)).toEqual([])
    const heavy = bulkLoadProjection([{ cpu: 2, memory_size_MiB: 27 * 1024 }], ['pve1'], stats)
    expect(bulkProjectionMemAlerts(heavy).map(r => r.node)).toEqual(['pve1'])
  })
})

describe('VM size readers', () => {
  it('reads the vCPU count under the names the source lists use, one at least', () => {
    expect(projectionVmVcpus({ cpu: 4 })).toBe(4)
    expect(projectionVmVcpus({ num_cpu: 2 })).toBe(2)
    expect(projectionVmVcpus({ cpuCount: 6 })).toBe(6)
    expect(projectionVmVcpus({})).toBe(1)
  })

  it('reads the configured memory in MiB, 0 when unknown', () => {
    expect(projectionVmMemoryBytes({ memory_size_MiB: 2048 })).toBe(2 * GiB)
    expect(projectionVmMemoryBytes({ memoryMB: 1024 })).toBe(GiB)
    expect(projectionVmMemoryBytes({})).toBe(0)
  })
})
