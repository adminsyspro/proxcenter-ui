import { describe, it, expect } from 'vitest'

import { aggregateStorage, normalizeStorageEntry } from './storage'

const TiB = 1024 ** 4

function raw(over: Partial<any> = {}) {
  return {
    connId: 'c1', connName: 'PVE-1', node: 'n1',
    storage: 'local-lvm', type: 'lvmthin', shared: false,
    used: 10 * TiB, total: 20 * TiB, content: ['images'],
    enabled: true, status: 'available',
    ...over,
  }
}

describe('aggregateStorage', () => {
  it('keeps same-named storages on different connections separate (#569)', () => {
    const out = aggregateStorage([
      raw({ connId: 'c1', connName: 'PVE-1', node: 'n1', used: 45 * TiB, total: 90 * TiB }),
      raw({ connId: 'c2', connName: 'PVE-2', node: 'm1', used: 3 * TiB, total: 15 * TiB }),
    ])
    const lvm = out.filter(s => s.storage === 'local-lvm')
    expect(lvm).toHaveLength(2)
    expect(lvm.find(s => s.connId === 'c1')!.total).toBe(90 * TiB)
    expect(lvm.find(s => s.connId === 'c2')!.total).toBe(15 * TiB)
    expect(lvm.map(s => s.id).sort()).toEqual(['c1:local-lvm', 'c2:local-lvm'])
  })

  it('sums a local storage across nodes of one cluster and builds nodeBreakdown', () => {
    const out = aggregateStorage([
      raw({ node: 'n1', used: 5 * TiB, total: 15 * TiB }),
      raw({ node: 'n2', used: 6 * TiB, total: 15 * TiB }),
      raw({ node: 'n3', used: 4 * TiB, total: 15 * TiB }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].total).toBe(45 * TiB)
    expect(out[0].used).toBe(15 * TiB)
    expect(out[0].usedPct).toBe(33.3)
    expect(out[0].allNodes.sort()).toEqual(['n1', 'n2', 'n3'])
    expect(out[0].nodeBreakdown).toHaveLength(3)
    expect(out[0].nodeBreakdown[0].totalFormatted).toBeTruthy()
  })

  it('treats a shared storage as one pool and is robust to a node reporting 0', () => {
    const out = aggregateStorage([
      raw({ storage: 'nfs1', type: 'nfs', shared: true, node: 'n1', used: 0, total: 0 }),
      raw({ storage: 'nfs1', type: 'nfs', shared: true, node: 'n2', used: 5 * TiB, total: 20 * TiB }),
    ])
    expect(out).toHaveLength(1)
    expect(out[0].shared).toBe(true)
    expect(out[0].total).toBe(20 * TiB)
    expect(out[0].used).toBe(5 * TiB)
    expect(out[0].nodeBreakdown).toHaveLength(1)
  })

  it('classifies by type when the shared flag is missing (zfs, rbd)', () => {
    const zfs = aggregateStorage([raw({ storage: 'zi', type: 'zfs', shared: false, node: 'n1', used: TiB, total: 2 * TiB })])
    const rbd = aggregateStorage([raw({ storage: 'ceph', type: 'rbd', shared: false, node: 'n1', used: TiB, total: 2 * TiB })])
    expect(zfs[0].shared).toBe(true)
    expect(rbd[0].shared).toBe(true)
  })

  it('excludes blank node names from allNodes', () => {
    const out = aggregateStorage([
      raw({ storage: 'nfs1', type: 'nfs', shared: true, node: '', used: 5 * TiB, total: 20 * TiB }),
    ])
    expect(out[0].allNodes).toEqual([])
  })

  it('yields (0,0) for a shared storage where every node reports total 0', () => {
    const out = aggregateStorage([
      raw({ storage: 'nfs0', type: 'nfs', shared: true, node: 'n1', used: 2 * TiB, total: 0 }),
      raw({ storage: 'nfs0', type: 'nfs', shared: true, node: 'n2', used: 3 * TiB, total: 0 }),
    ])
    expect(out[0].used).toBe(0)
    expect(out[0].total).toBe(0)
    expect(out[0].usedPct).toBe(0)
  })

  it('returns an empty array for empty input', () => {
    expect(aggregateStorage([])).toEqual([])
  })

  it('normalizeStorageEntry maps disk/maxdisk and shared 1|0', () => {
    const e = normalizeStorageEntry({ connId: 'c1', connName: 'X', node: 'n1', storage: 's', plugintype: 'nfs', shared: 1, disk: 5, maxdisk: 10, content: 'images,iso' })
    expect(e.used).toBe(5)
    expect(e.total).toBe(10)
    expect(e.shared).toBe(true)
    expect(e.type).toBe('nfs')
    expect(e.content).toEqual(['images', 'iso'])
  })
})
