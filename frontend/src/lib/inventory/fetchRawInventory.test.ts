import { describe, expect, it, vi, beforeEach } from 'vitest'

const { getInventoryFromCacheMock, setCachedInventoryMock, getInflightFetchMock, setInflightFetchMock, getSessionPrismaMock } =
  vi.hoisted(() => ({
    getInventoryFromCacheMock: vi.fn<(tenantId?: string) => any>(),
    setCachedInventoryMock: vi.fn(),
    getInflightFetchMock: vi.fn<() => any>(),
    setInflightFetchMock: vi.fn(),
    // A vi.fn (not a fixed async arrow) so one test can make the "expensive"
    // fetch hang on demand, to prove nonBlocking never awaits it.
    getSessionPrismaMock: vi.fn<() => any>(),
  }))

vi.mock('@/lib/cache/inventoryCache', () => ({
  getInventoryFromCache: getInventoryFromCacheMock,
  setCachedInventory: setCachedInventoryMock,
  getInflightFetch: getInflightFetchMock,
  setInflightFetch: setInflightFetchMock,
}))

vi.mock('@/lib/tenant', () => ({
  getSessionPrisma: getSessionPrismaMock,
  getCurrentTenantId: async () => 'default',
}))

vi.mock('@/lib/db/prisma', () => ({ prisma: { connection: { findMany: async () => [] } } }))

import { getInventorySWR } from './fetchRawInventory'

const RAW = {
  clusters: [],
  pbsServers: [],
  externalHypervisors: [],
  storages: [],
  stats: {
    totalClusters: 0, totalNodes: 0, totalGuests: 0, onlineNodes: 0,
    runningGuests: 0, totalPbsServers: 0, totalDatastores: 0, totalBackups: 0,
  },
}

beforeEach(() => {
  vi.clearAllMocks()
  getInflightFetchMock.mockReturnValue(null)
  getSessionPrismaMock.mockResolvedValue({ connection: { findMany: async () => [] } })
})

describe('getInventorySWR', () => {
  it('serves fresh cache without fetching', async () => {
    getInventoryFromCacheMock.mockReturnValue({ status: 'fresh', data: RAW })
    const out = await getInventorySWR('default', { kind: 'provider' } as any)
    expect(out.cached).toBe(true)
    expect(out.raw).toBe(RAW)
    expect(setInflightFetchMock).not.toHaveBeenCalled()
  })

  it('serves stale cache and triggers a background revalidation', async () => {
    getInventoryFromCacheMock.mockReturnValue({ status: 'stale', data: RAW })
    const out = await getInventorySWR('default', { kind: 'provider' } as any)
    expect(out.cached).toBe(true)
    expect(out.raw).toBe(RAW)
    expect(setInflightFetchMock).toHaveBeenCalled()
  })

  it('blocks on a miss and reports cached: false', async () => {
    getInventoryFromCacheMock.mockReturnValue({ status: 'miss' })
    const out = await getInventorySWR('default', { kind: 'provider' } as any)
    expect(out.cached).toBe(false)
    expect(out.raw).toEqual(RAW)
    expect(setCachedInventoryMock).toHaveBeenCalled()
  })

  it('forceRefresh skips the cache lookup entirely', async () => {
    getInventoryFromCacheMock.mockReturnValue({ status: 'fresh', data: RAW })
    const out = await getInventorySWR('default', { kind: 'provider' } as any, true)
    expect(out.cached).toBe(false)
    expect(out.raw).toEqual(RAW)
    expect(getInventoryFromCacheMock).not.toHaveBeenCalled()
  })

  it('D12: nonBlocking on a miss returns empty immediately, without waiting for the fetch, and warms the cache in the background', async () => {
    getInventoryFromCacheMock.mockReturnValue({ status: 'miss' })
    // Makes the real fetchRawInventory() hang until resolveConn() is
    // called: if getInventorySWR still awaited it under nonBlocking, this
    // test would time out instead of resolving quickly.
    let resolveConn: (() => void) | undefined
    const pending = new Promise<any>(resolve => {
      resolveConn = () => resolve({ connection: { findMany: async () => [] } })
    })
    getSessionPrismaMock.mockReturnValue(pending)

    const out = await getInventorySWR('default', { kind: 'provider' } as any, false, true)

    expect(out.cached).toBe(false)
    expect(out.raw).toEqual(RAW) // the empty default, NOT an awaited real fetch result
    expect(setInflightFetchMock).toHaveBeenCalled() // background revalidation was scheduled
    expect(setCachedInventoryMock).not.toHaveBeenCalled() // the background fetch has not resolved yet

    // Let the background fetch complete so nothing dangles past the test.
    resolveConn!()
    await pending
  })

  it('the existing (non-nonBlocking) miss path still blocks the caller, unchanged', async () => {
    getInventoryFromCacheMock.mockReturnValue({ status: 'miss' })
    let resolved = false
    getSessionPrismaMock.mockImplementation(async () => {
      await new Promise(r => setTimeout(r, 5))
      resolved = true
      return { connection: { findMany: async () => [] } }
    })

    const out = await getInventorySWR('default', { kind: 'provider' } as any, false, false)

    expect(resolved).toBe(true) // the caller genuinely waited for it
    expect(out.cached).toBe(false)
    expect(setCachedInventoryMock).toHaveBeenCalled()
  })
})
