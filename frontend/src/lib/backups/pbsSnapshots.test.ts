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
  vi.resetAllMocks()
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

  it('serves stale data immediately and refreshes it in the background', async () => {
    const staleData = [{ id: 'stale-1' }]
    getPbsBackupsFromCacheMock.mockReturnValue({ status: 'stale', data: staleData, warnings: ['old warning'] })
    pbsFetchMock.mockImplementation(async (_c: any, path: string) => {
      if (path === '/admin/datastore') return [{ store: 'ds1' }]
      if (path.includes('/namespace')) return []
      if (path.includes('/snapshots')) {
        return [{ 'backup-type': 'vm', 'backup-id': '2', 'backup-time': 2 }]
      }
      throw new Error(`unexpected path ${path}`)
    })

    const result = await getAllBackups('pbs-1', conn, 'default', 'en-US')

    // The stale entry is served synchronously, before any refresh completes.
    expect(result).toEqual({ data: staleData, warnings: ['old warning'], fromCache: true })
    expect(setInflightPbsFetchMock).toHaveBeenCalledWith(expect.any(Promise), 'pbs-1', 'default', 'en-US')

    // Drive the background refresh to completion and verify it lands.
    const refreshPromise = setInflightPbsFetchMock.mock.calls[0][0]
    await refreshPromise

    expect(setCachedPbsBackupsMock).toHaveBeenCalledWith(
      'pbs-1',
      expect.arrayContaining([expect.objectContaining({ backupId: '2' })]),
      [],
      'default',
      'en-US',
    )
    expect(setInflightPbsFetchMock).toHaveBeenLastCalledWith(null, 'pbs-1', 'default', 'en-US')
  })

  it('a failed background refresh on a stale hit resolves to the stale snapshot, never an unhandled rejection', async () => {
    const staleData = [{ id: 'stale-1' }]
    getPbsBackupsFromCacheMock.mockReturnValue({ status: 'stale', data: staleData, warnings: ['old warning'] })
    pbsFetchMock.mockImplementation(async (_c: any, path: string) => {
      if (path === '/admin/datastore') throw new Error('PBS unreachable')
      throw new Error(`unexpected path ${path}`)
    })

    const result = await getAllBackups('pbs-1', conn, 'default', 'en-US')
    expect(result).toEqual({ data: staleData, warnings: ['old warning'], fromCache: true })

    const refreshPromise = setInflightPbsFetchMock.mock.calls[0][0]
    const settled = await refreshPromise
    // The .catch() fallback, not a thrown/rejected promise: the caller of
    // getAllBackups never awaits this promise, so a rejection here would be
    // an unhandled rejection in production.
    expect(settled).toEqual({ data: staleData, warnings: ['old warning'] })
    expect(setCachedPbsBackupsMock).not.toHaveBeenCalled()
    expect(setInflightPbsFetchMock).toHaveBeenLastCalledWith(null, 'pbs-1', 'default', 'en-US')
  })

  it('a stale hit with a refresh already in flight does not start a second one', async () => {
    const staleData = [{ id: 'stale-1' }]
    getPbsBackupsFromCacheMock.mockReturnValue({ status: 'stale', data: staleData, warnings: [] })
    const alreadyRunning = new Promise(() => {}) // never resolves within this test
    getInflightPbsFetchMock.mockReturnValue(alreadyRunning)

    const result = await getAllBackups('pbs-1', conn, 'default', 'en-US')

    expect(result).toEqual({ data: staleData, warnings: [], fromCache: true })
    expect(setInflightPbsFetchMock).not.toHaveBeenCalled()
    expect(pbsFetchMock).not.toHaveBeenCalled()
  })

  it('reuses an in-flight fetch instead of firing a duplicate request', async () => {
    getPbsBackupsFromCacheMock.mockReturnValue({ status: 'miss' })
    const inflight = Promise.resolve({ data: [{ id: 'inflight-1' }], warnings: ['inflight warning'] })
    getInflightPbsFetchMock.mockReturnValue(inflight)

    const result = await getAllBackups('pbs-1', conn, 'default', 'en-US')

    expect(result).toEqual({ data: [{ id: 'inflight-1' }], warnings: ['inflight warning'], fromCache: false })
    expect(pbsFetchMock).not.toHaveBeenCalled()
    expect(setCachedPbsBackupsMock).not.toHaveBeenCalled()
  })

  it('D12: nonBlocking on a miss returns empty immediately, without waiting for PBS, and warms the cache in the background', async () => {
    getPbsBackupsFromCacheMock.mockReturnValue({ status: 'miss' })
    // /admin/datastore hangs until resolveDatastores() is called: if
    // getAllBackups still awaited the fetch under nonBlocking, this test
    // would time out instead of resolving quickly.
    let resolveDatastores: ((v: any[]) => void) | undefined
    pbsFetchMock.mockImplementation((_c: any, path: string) => {
      if (path === '/admin/datastore') {
        return new Promise<any[]>(resolve => { resolveDatastores = resolve })
      }
      return Promise.resolve([])
    })

    const result = await getAllBackups('pbs-1', conn, 'default', 'en-US', true)

    expect(result).toEqual({ data: [], warnings: [], fromCache: false })
    expect(setInflightPbsFetchMock).toHaveBeenCalledWith(expect.any(Promise), 'pbs-1', 'default', 'en-US')
    expect(setCachedPbsBackupsMock).not.toHaveBeenCalled() // the background fetch has not resolved yet

    // Let the background fetch complete so nothing dangles past the test.
    resolveDatastores!([])
    await setInflightPbsFetchMock.mock.calls[0][0]
    expect(setCachedPbsBackupsMock).toHaveBeenCalledWith('pbs-1', [], [], 'default', 'en-US')
  })

  it('the existing (non-nonBlocking) miss path still blocks the caller, unchanged', async () => {
    getPbsBackupsFromCacheMock.mockReturnValue({ status: 'miss' })
    let resolved = false
    pbsFetchMock.mockImplementation(async (_c: any, path: string) => {
      if (path === '/admin/datastore') {
        await new Promise(r => setTimeout(r, 5))
        resolved = true
        return []
      }
      return []
    })

    const result = await getAllBackups('pbs-1', conn, 'default', 'en-US', false)

    expect(resolved).toBe(true) // the caller genuinely waited for it
    expect(result.fromCache).toBe(false)
    expect(setCachedPbsBackupsMock).toHaveBeenCalled()
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

  it('falls back to `name` when `store` is absent, and skips a datastore with neither', async () => {
    pbsFetchMock.mockImplementation(async (_c: any, path: string) => {
      if (path === '/admin/datastore') return [{ name: 'ds-by-name' }, {}]
      if (path === '/admin/datastore/ds-by-name/namespace') return []
      if (path === '/admin/datastore/ds-by-name/snapshots') {
        return [{ 'backup-type': 'vm', 'backup-id': '1', 'backup-time': 1 }]
      }
      throw new Error(`unexpected path ${path}`)
    })

    const result = await fetchAllPbsBackups(conn, 'en-US')

    // The nameless datastore never even reaches pbsFetch (no throw above),
    // and contributes nothing -- the store-by-name one still resolves.
    expect(result.data).toHaveLength(1)
    expect(result.data[0].datastore).toBe('ds-by-name')
  })

  it('falls back to root-only namespaces when the namespace endpoint resolves without an array (older PBS)', async () => {
    pbsFetchMock.mockImplementation(async (_c: any, path: string) => {
      if (path === '/admin/datastore') return [{ store: 'ds1' }]
      // Resolves (does not throw) but with a non-array body: Array.isArray
      // must gate the subNs expansion, not just a try/catch around it.
      if (path === '/admin/datastore/ds1/namespace') return { error: 'not supported' } as any
      if (path === '/admin/datastore/ds1/snapshots') {
        return [{ 'backup-type': 'vm', 'backup-id': '1', 'backup-time': 1 }]
      }
      throw new Error(`unexpected path ${path}`)
    })

    const result = await fetchAllPbsBackups(conn, 'en-US')

    expect(result.data).toHaveLength(1)
    expect(result.data[0].namespace).toBe('')
  })

  it('expands real sub-namespaces (dropping blank/malformed entries) and queries each one', async () => {
    const queriedPaths: string[] = []
    pbsFetchMock.mockImplementation(async (_c: any, path: string) => {
      queriedPaths.push(path)
      if (path === '/admin/datastore') return [{ store: 'ds1' }]
      if (path === '/admin/datastore/ds1/namespace') {
        return [{ ns: 'team-a' }, { ns: '' }, {}]
      }
      if (path === '/admin/datastore/ds1/snapshots') {
        return [{ 'backup-type': 'vm', 'backup-id': 'root-1', 'backup-time': 1 }]
      }
      if (path === '/admin/datastore/ds1/snapshots?ns=team-a') {
        return [{ 'backup-type': 'vm', 'backup-id': 'ns-1', 'backup-time': 2 }]
      }
      throw new Error(`unexpected path ${path}`)
    })

    const result = await fetchAllPbsBackups(conn, 'en-US')

    // Only ONE real sub-namespace ('team-a'); the blank and nsless entries
    // were filtered out, not queried as their own (empty-string) namespace
    // a second time.
    expect(queriedPaths.filter(p => p.startsWith('/admin/datastore/ds1/snapshots')).sort()).toEqual([
      '/admin/datastore/ds1/snapshots',
      '/admin/datastore/ds1/snapshots?ns=team-a',
    ])
    expect(result.data.map(b => `${b.namespace}/${b.backupId}`).sort()).toEqual(['/root-1', 'team-a/ns-1'])
    // The id embeds the namespace segment only when it is non-empty.
    const nsBackup = result.data.find(b => b.backupId === 'ns-1')
    expect(nsBackup?.id).toBe('ds1/team-a/vm/ns-1/2')
    const rootBackup = result.data.find(b => b.backupId === 'root-1')
    expect(rootBackup?.id).toBe('ds1/vm/root-1/1')
  })

  it('derives every field of a fully-populated snapshot (the branches a bare-minimum snapshot never reaches)', async () => {
    pbsFetchMock.mockImplementation(async (_c: any, path: string) => {
      if (path === '/admin/datastore') return [{ store: 'ds1' }]
      if (path === '/admin/datastore/ds1/namespace') return []
      if (path === '/admin/datastore/ds1/snapshots') {
        return [{
          'backup-type': 'vm',
          'backup-id': '100',
          'backup-time': 1_700_000_000,
          comment: 'nightly backup',
          size: 4096,
          files: ['qemu-server.conf', 'drive-scsi0.img.fidx'],
          verification: { state: 'ok', upid: 'UPID:node:...', 'last-run': 1_700_000_100 },
          protected: true,
          owner: 'root@pam',
        }]
      }
      throw new Error(`unexpected path ${path}`)
    })

    const [backup] = (await fetchAllPbsBackups(conn, 'en-US')).data

    expect(backup.vmName).toBe('nightly backup')
    expect(backup.fileCount).toBe(2)
    expect(backup.verified).toBe(true)
    expect(backup.verifiedAt).toBe(new Date(1_700_000_100 * 1000).toLocaleString('en-US'))
    expect(backup.protected).toBe(true)
    expect(backup.owner).toBe('root@pam')
    expect(backup.comment).toBe('nightly backup')
    expect(backup.backupTimeFormatted).toBe(new Date(1_700_000_000 * 1000).toLocaleString('en-US'))
    expect(backup.backupTimeIso).toBe(new Date(1_700_000_000 * 1000).toISOString())
  })

  it('a snapshot with no backup-time formats as "-"/"" instead of an Invalid Date', async () => {
    pbsFetchMock.mockImplementation(async (_c: any, path: string) => {
      if (path === '/admin/datastore') return [{ store: 'ds1' }]
      if (path === '/admin/datastore/ds1/namespace') return []
      if (path === '/admin/datastore/ds1/snapshots') {
        return [{ 'backup-type': 'vm', 'backup-id': '100', 'backup-time': 0 }]
      }
      throw new Error(`unexpected path ${path}`)
    })

    const [backup] = (await fetchAllPbsBackups(conn, 'en-US')).data

    expect(backup.backupTimeFormatted).toBe('-')
    expect(backup.backupTimeIso).toBe('')
    expect(backup.verifiedAt).toBeNull()
  })
})
