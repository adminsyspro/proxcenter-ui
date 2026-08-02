import { describe, expect, it, vi, beforeEach } from 'vitest'

const {
  pbsFetchMock,
  getPbsBackupsFromCacheMock,
  setCachedPbsBackupsMock,
  getInflightPbsFetchMock,
  setInflightPbsFetchMock,
} = vi.hoisted(() => ({
  pbsFetchMock: vi.fn<(...args: any[]) => Promise<any>>(),
  getPbsBackupsFromCacheMock: vi.fn<(...args: any[]) => any>(),
  setCachedPbsBackupsMock: vi.fn<(...args: any[]) => void>(),
  getInflightPbsFetchMock: vi.fn<(...args: any[]) => any>(),
  setInflightPbsFetchMock: vi.fn<(...args: any[]) => void>(),
}))

vi.mock('@/lib/proxmox/pbs-client', () => ({ pbsFetch: pbsFetchMock }))
vi.mock('@/lib/cache/pbsBackupCache', () => ({
  getPbsBackupsFromCache: getPbsBackupsFromCacheMock,
  setCachedPbsBackups: setCachedPbsBackupsMock,
  getInflightPbsFetch: getInflightPbsFetchMock,
  setInflightPbsFetch: setInflightPbsFetchMock,
}))

import { fetchAllPbsBackups, getAllBackups } from './pbsSnapshots'

const conn = { baseUrl: 'https://pbs.example', apiToken: 'x' }

beforeEach(() => {
  vi.clearAllMocks()
  getInflightPbsFetchMock.mockReturnValue(null)
})

describe('getAllBackups', () => {
  it('returns cached data on a fresh cache hit, without calling PBS', async () => {
    getPbsBackupsFromCacheMock.mockReturnValue({
      status: 'fresh',
      data: [{ id: 'cached-1' }],
      warnings: ['stale warning'],
    })

    const result = await getAllBackups('pbs-1', conn, 'default', 'en-US')

    expect(result).toEqual({ data: [{ id: 'cached-1' }], warnings: ['stale warning'], fromCache: true })
    expect(pbsFetchMock).not.toHaveBeenCalled()
    expect(setCachedPbsBackupsMock).not.toHaveBeenCalled()
  })

  it('performs a blocking fetch on a cache miss and stores the result in the cache', async () => {
    getPbsBackupsFromCacheMock.mockReturnValue({ status: 'miss' })
    pbsFetchMock.mockImplementation(async (_c: any, path: string) => {
      if (path === '/admin/datastore') return [{ store: 'ds1' }]
      if (path.includes('/namespace')) return []
      if (path.includes('/snapshots')) {
        return [{ 'backup-type': 'vm', 'backup-id': '100', 'backup-time': 1_700_000_000, size: 512 }]
      }
      throw new Error(`unexpected path ${path}`)
    })

    const result = await getAllBackups('pbs-1', conn, 'default', 'en-US')

    expect(result.fromCache).toBe(false)
    expect(result.data).toHaveLength(1)
    expect(result.data[0].backupId).toBe('100')
    expect(result.data[0].datastore).toBe('ds1')
    expect(setCachedPbsBackupsMock).toHaveBeenCalledWith('pbs-1', result.data, [], 'default', 'en-US')
  })
})

describe('fetchAllPbsBackups', () => {
  it('accumulates a warning when one datastore fails, without losing the others', async () => {
    pbsFetchMock.mockImplementation(async (_c: any, path: string) => {
      if (path === '/admin/datastore') return [{ store: 'ok' }, { store: 'broken' }]
      if (path === '/admin/datastore/ok/namespace') return []
      if (path === '/admin/datastore/ok/snapshots') {
        return [{ 'backup-type': 'vm', 'backup-id': '1', 'backup-time': 1 }]
      }
      if (path === '/admin/datastore/broken/namespace') return []
      if (path === '/admin/datastore/broken/snapshots') throw new Error('boom')
      throw new Error(`unexpected path ${path}`)
    })

    const result = await fetchAllPbsBackups(conn, 'en-US')

    expect(result.data).toHaveLength(1)
    expect(result.data[0].datastore).toBe('ok')
    expect(result.warnings).toEqual(["Failed to fetch datastore 'broken': boom"])
  })
})
