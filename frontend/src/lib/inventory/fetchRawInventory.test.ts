import { describe, expect, it, vi, beforeEach } from 'vitest'

const { getInventoryFromCacheMock, setCachedInventoryMock, getInflightFetchMock, setInflightFetchMock } =
  vi.hoisted(() => ({
    getInventoryFromCacheMock: vi.fn<(tenantId?: string) => any>(),
    setCachedInventoryMock: vi.fn(),
    getInflightFetchMock: vi.fn<() => any>(),
    setInflightFetchMock: vi.fn(),
  }))

vi.mock('@/lib/cache/inventoryCache', () => ({
  getInventoryFromCache: getInventoryFromCacheMock,
  setCachedInventory: setCachedInventoryMock,
  getInflightFetch: getInflightFetchMock,
  setInflightFetch: setInflightFetchMock,
}))

vi.mock('@/lib/tenant', () => ({
  getSessionPrisma: async () => ({ connection: { findMany: async () => [] } }),
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
    expect(setInflightFetchMock).toHaveBeenCalled()
  })

  it('blocks on a miss and reports cached: false', async () => {
    getInventoryFromCacheMock.mockReturnValue({ status: 'miss' })
    const out = await getInventorySWR('default', { kind: 'provider' } as any)
    expect(out.cached).toBe(false)
    expect(out.raw.stats.totalClusters).toBe(0)
  })

  it('forceRefresh skips the cache lookup entirely', async () => {
    getInventoryFromCacheMock.mockReturnValue({ status: 'fresh', data: RAW })
    const out = await getInventorySWR('default', { kind: 'provider' } as any, true)
    expect(out.cached).toBe(false)
    expect(getInventoryFromCacheMock).not.toHaveBeenCalled()
  })
})
