import { describe, it, expect, vi, beforeEach } from 'vitest'

const { pveFetchMock } = vi.hoisted(() => ({ pveFetchMock: vi.fn<(...args: any[]) => Promise<any>>() }))

vi.mock('@/lib/proxmox/client', () => ({ pveFetch: pveFetchMock }))
vi.mock('@/utils/format', () => ({ formatBytes: (n: number) => `${n}B` }))

import {
  parseVzdumpVolidTime,
  vzdumpBackupTypeFromVolid,
  resolveVzdumpScanTargets,
  VZDUMP_MAX_PAIRS,
  listGuestVzdumpBackups,
} from './pveVzdump'

describe('parseVzdumpVolidTime', () => {
  it('extracts the timestamp encoded in a vzdump filename', () => {
    const t = parseVzdumpVolidTime('local:backup/vzdump-qemu-111-2026_08_11-15_51_33.vma.zst')
    expect(t).not.toBeNull()
    expect(new Date(t! * 1000).toISOString()).toBe('2026-08-11T15:51:33.000Z')
  })

  it('returns null when the volid carries no date', () => {
    expect(parseVzdumpVolidTime('local:backup/whatever.vma.zst')).toBeNull()
  })
})

describe('vzdumpBackupTypeFromVolid', () => {
  it('maps qemu archives to vm', () => {
    expect(vzdumpBackupTypeFromVolid('local:backup/vzdump-qemu-111-2026_08_11-15_51_33.vma.zst')).toBe('vm')
  })

  it('maps lxc archives to ct', () => {
    expect(vzdumpBackupTypeFromVolid('local:backup/vzdump-lxc-200-2026_08_11-15_51_33.tar.zst')).toBe('ct')
  })

  it('maps legacy openvz archives to ct', () => {
    expect(vzdumpBackupTypeFromVolid('local:backup/vzdump-openvz-200-2026_08_11-15_51_33.tar.lzo')).toBe('ct')
  })

  it('returns null for a non-vzdump volid', () => {
    expect(vzdumpBackupTypeFromVolid('local:iso/debian.iso')).toBeNull()
  })
})

const nodes = (...names: string[]) =>
  names.map(n => ({ type: 'node', node: n, status: 'online' }))

const storageRes = (storage: string, node: string, status = 'available') =>
  ({ type: 'storage', storage, node, status })

describe('resolveVzdumpScanTargets', () => {
  it('keeps only backup-capable storages that are not PBS', () => {
    const { targets } = resolveVzdumpScanTargets(
      [
        { storage: 'local', type: 'dir', content: 'backup,iso', shared: 0 },
        { storage: 'pbs-01', type: 'pbs', content: 'backup', shared: 1 },
        { storage: 'data', type: 'lvmthin', content: 'images', shared: 0 },
      ],
      [...nodes('node1'), storageRes('local', 'node1'), storageRes('pbs-01', 'node1'), storageRes('data', 'node1')],
    )
    expect(targets).toEqual([{ node: 'node1', storage: 'local' }])
  })

  it('queries a non-shared storage on every online node', () => {
    const { targets } = resolveVzdumpScanTargets(
      [{ storage: 'local', type: 'dir', content: 'backup', shared: 0 }],
      [...nodes('node1', 'node2'), storageRes('local', 'node1'), storageRes('local', 'node2')],
    )
    expect(targets).toEqual([
      { node: 'node1', storage: 'local' },
      { node: 'node2', storage: 'local' },
    ])
  })

  it('queries a shared storage only once', () => {
    const { targets } = resolveVzdumpScanTargets(
      [{ storage: 'nfs-bkp', type: 'nfs', content: 'backup', shared: 1 }],
      [...nodes('node1', 'node2'), storageRes('nfs-bkp', 'node1'), storageRes('nfs-bkp', 'node2')],
    )
    expect(targets).toEqual([{ node: 'node1', storage: 'nfs-bkp' }])
  })

  it('skips offline nodes', () => {
    const { targets } = resolveVzdumpScanTargets(
      [{ storage: 'local', type: 'dir', content: 'backup', shared: 0 }],
      [
        { type: 'node', node: 'node1', status: 'online' },
        { type: 'node', node: 'node2', status: 'offline' },
        storageRes('local', 'node1'),
        storageRes('local', 'node2'),
      ],
    )
    expect(targets).toEqual([{ node: 'node1', storage: 'local' }])
  })

  it('still scans a storage whose status is indeterminate', () => {
    // `status` derives from RRD stats and can stay unknown without meaning the
    // storage is absent — treat `available` as a positive signal, never a filter.
    const { targets } = resolveVzdumpScanTargets(
      [{ storage: 'local', type: 'dir', content: 'backup', shared: 0 }],
      [...nodes('node1'), storageRes('local', 'node1', 'unknown')],
    )
    expect(targets).toEqual([{ node: 'node1', storage: 'local' }])
  })

  it('puts the guest current node first and truncates past the hard cap', () => {
    const many = Array.from({ length: 40 }, (_, i) => `node${i + 1}`)
    const { targets, truncated } = resolveVzdumpScanTargets(
      [{ storage: 'local', type: 'dir', content: 'backup', shared: 0 }],
      [...nodes(...many), ...many.map(n => storageRes('local', n))],
      'node40',
    )
    expect(truncated).toBe(true)
    expect(targets).toHaveLength(VZDUMP_MAX_PAIRS)
    expect(targets[0]).toEqual({ node: 'node40', storage: 'local' })
  })

  it('preserves current node pairs across multiple storages when truncating', () => {
    const many = Array.from({ length: 20 }, (_, i) => `node${i + 1}`)
    const storages = [
      { storage: 'local', type: 'dir', content: 'backup', shared: 0 },
      { storage: 'backup2', type: 'dir', content: 'backup', shared: 0 },
    ]
    const resources = [
      ...nodes(...many),
      ...many.map(n => storageRes('local', n)),
      ...many.map(n => storageRes('backup2', n)),
    ]
    const { targets, truncated } = resolveVzdumpScanTargets(storages, resources, 'node5')
    expect(truncated).toBe(true)
    expect(targets).toHaveLength(VZDUMP_MAX_PAIRS)
    const firstTwo = new Set([
      JSON.stringify(targets[0]),
      JSON.stringify(targets[1]),
    ])
    expect(firstTwo).toEqual(
      new Set([
        JSON.stringify({ node: 'node5', storage: 'local' }),
        JSON.stringify({ node: 'node5', storage: 'backup2' }),
      ]),
    )
  })

  it('does not truncate when targets length equals the hard cap', () => {
    const many = Array.from({ length: 16 }, (_, i) => `node${i + 1}`)
    const storages = [
      { storage: 'local', type: 'dir', content: 'backup', shared: 0 },
      { storage: 'backup2', type: 'dir', content: 'backup', shared: 0 },
    ]
    const resources = [
      ...nodes(...many),
      ...many.map(n => storageRes('local', n)),
      ...many.map(n => storageRes('backup2', n)),
    ]
    const { targets, truncated } = resolveVzdumpScanTargets(storages, resources)
    expect(targets).toHaveLength(VZDUMP_MAX_PAIRS)
    expect(truncated).toBe(false)
  })
})

const CONN = { id: 'pve-1', baseUrl: 'https://pve.local', apiToken: 't' }

const RESOURCES = [
  { type: 'node', node: 'node1', status: 'online' },
  { type: 'node', node: 'node2', status: 'online' },
  { type: 'storage', storage: 'local', node: 'node1', status: 'available' },
  { type: 'storage', storage: 'local', node: 'node2', status: 'available' },
]

const STORAGES = [{ storage: 'local', type: 'dir', content: 'backup', shared: 0 }]

beforeEach(() => {
  pveFetchMock.mockReset()
})

describe('listGuestVzdumpBackups', () => {
  it('returns archives found on the node that holds them', async () => {
    pveFetchMock.mockImplementation(async (_c: any, path: string) => {
      if (path === '/cluster/resources') return RESOURCES
      if (path.startsWith('/nodes/node2/storage/local/content')) {
        return [{
          volid: 'local:backup/vzdump-qemu-111-2026_08_11-15_51_33.vma.zst',
          ctime: 1786000293,
          size: 4600000000,
          format: 'vma.zst',
          vmid: 111,
        }]
      }
      return []
    })

    const { data, warnings } = await listGuestVzdumpBackups(CONN, '111', {
      typeFilter: 'vm',
      dateLocale: 'en',
      storages: STORAGES,
    })

    expect(warnings).toEqual([])
    expect(data).toHaveLength(1)
    expect(data[0]).toMatchObject({
      source: 'vzdump',
      node: 'node2',
      storage: 'local',
      backupType: 'vm',
      backupId: '111',
      backupTime: 1786000293,
      backupTimeKnown: true,
      size: 4600000000,
      sizeFormatted: '4600000000B',
      verified: false,
      verification: null,
      volid: 'local:backup/vzdump-qemu-111-2026_08_11-15_51_33.vma.zst',
    })
    expect(data[0].id).toBe('node2/local:backup/vzdump-qemu-111-2026_08_11-15_51_33.vma.zst')
  })

  it('passes the vmid filter to PVE and asks for backup content only', async () => {
    pveFetchMock.mockImplementation(async (_c: any, path: string) =>
      path === '/cluster/resources' ? RESOURCES : [])

    await listGuestVzdumpBackups(CONN, '111', {
      typeFilter: 'vm', dateLocale: 'en', storages: STORAGES,
    })

    const contentCalls = pveFetchMock.mock.calls
      .map(c => String(c[1]))
      .filter(p => p.includes('/content'))

    expect(contentCalls).toHaveLength(2)
    for (const p of contentCalls) {
      expect(p).toContain('content=backup')
      expect(p).toContain('vmid=111')
    }
  })

  it('drops archives whose type does not match the requested guest type', async () => {
    pveFetchMock.mockImplementation(async (_c: any, path: string) => {
      if (path === '/cluster/resources') return RESOURCES
      if (path.startsWith('/nodes/node1/storage/local/content')) {
        return [
          { volid: 'local:backup/vzdump-qemu-111-2026_08_11-15_51_33.vma.zst', ctime: 1, size: 1 },
          { volid: 'local:backup/vzdump-lxc-111-2026_08_11-15_51_33.tar.zst', ctime: 2, size: 1 },
        ]
      }
      return []
    })

    const { data } = await listGuestVzdumpBackups(CONN, '111', {
      typeFilter: 'ct', dateLocale: 'en', storages: STORAGES,
    })

    expect(data).toHaveLength(1)
    expect(data[0].backupType).toBe('ct')
  })

  it('falls back to the volid timestamp when ctime is missing', async () => {
    pveFetchMock.mockImplementation(async (_c: any, path: string) => {
      if (path === '/cluster/resources') return RESOURCES
      if (path.startsWith('/nodes/node1/storage/local/content')) {
        return [{ volid: 'local:backup/vzdump-qemu-111-2026_08_11-15_51_33.vma.zst' }]
      }
      return []
    })

    const { data } = await listGuestVzdumpBackups(CONN, '111', {
      typeFilter: 'vm', dateLocale: 'en', storages: STORAGES,
    })

    expect(data[0].backupTime).toBe(Math.floor(Date.UTC(2026, 7, 11, 15, 51, 33) / 1000))
    expect(data[0].backupTimeKnown).toBe(true)
    expect(data[0].size).toBe(0)
  })

  it('marks the time unknown and sorts the entry last when nothing is parsable', async () => {
    pveFetchMock.mockImplementation(async (_c: any, path: string) => {
      if (path === '/cluster/resources') return RESOURCES
      if (path.startsWith('/nodes/node1/storage/local/content')) {
        return [
          { volid: 'local:backup/vzdump-qemu-111-undated.vma.zst' },
          { volid: 'local:backup/vzdump-qemu-111-2026_08_11-15_51_33.vma.zst', ctime: 900 },
        ]
      }
      return []
    })

    const { data } = await listGuestVzdumpBackups(CONN, '111', {
      typeFilter: 'vm', dateLocale: 'en', storages: STORAGES,
    })

    expect(data).toHaveLength(2)
    expect(data[data.length - 1].backupTimeKnown).toBe(false)
    expect(data[data.length - 1].backupTime).toBe(0)
  })

  it('reports a warning when one node fails but keeps the others', async () => {
    pveFetchMock.mockImplementation(async (_c: any, path: string) => {
      if (path === '/cluster/resources') return RESOURCES
      if (path.startsWith('/nodes/node1/storage/local/content')) throw new Error('node1 down')
      if (path.startsWith('/nodes/node2/storage/local/content')) {
        return [{ volid: 'local:backup/vzdump-qemu-111-2026_08_11-15_51_33.vma.zst', ctime: 5, size: 2 }]
      }
      return []
    })

    const { data, warnings } = await listGuestVzdumpBackups(CONN, '111', {
      typeFilter: 'vm', dateLocale: 'en', storages: STORAGES,
    })

    expect(data).toHaveLength(1)
    expect(warnings).toHaveLength(1)
    expect(warnings[0]).toContain('node1/local')
  })

  it('warns and returns nothing when the cluster topology cannot be read', async () => {
    pveFetchMock.mockRejectedValue(new Error('cluster unreachable'))

    const { data, warnings } = await listGuestVzdumpBackups(CONN, '111', {
      typeFilter: 'vm', dateLocale: 'en', storages: STORAGES,
    })

    expect(data).toEqual([])
    expect(warnings).toHaveLength(1)
  })

  it('does nothing when no storage supports backup content', async () => {
    const { data, warnings } = await listGuestVzdumpBackups(CONN, '111', {
      typeFilter: 'vm',
      dateLocale: 'en',
      storages: [{ storage: 'data', type: 'lvmthin', content: 'images', shared: 0 }],
    })

    expect(data).toEqual([])
    expect(warnings).toEqual([])
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('deduplicates the same archive reported by two nodes', async () => {
    // Non-shared storage, so BOTH nodes are queried and both answer with the
    // same volid — this is what actually exercises the dedup path.
    pveFetchMock.mockImplementation(async (_c: any, path: string) => {
      if (path === '/cluster/resources') return RESOURCES
      if (path.includes('/content')) {
        return [{ volid: 'local:backup/vzdump-qemu-111-2026_08_11-15_51_33.vma.zst', ctime: 5, size: 2 }]
      }
      return []
    })

    const { data } = await listGuestVzdumpBackups(CONN, '111', {
      typeFilter: 'vm',
      dateLocale: 'en',
      storages: STORAGES,
    })

    const contentCalls = pveFetchMock.mock.calls
      .map(c => String(c[1]))
      .filter(p => p.includes('/content'))

    expect(contentCalls).toHaveLength(2)
    expect(data).toHaveLength(1)
  })
})
