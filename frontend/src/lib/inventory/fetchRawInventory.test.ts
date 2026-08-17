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

/** Returns the promise the code under test parked in the shared in-flight slot. */
function storedInflightPromise() {
  const call = setInflightFetchMock.mock.calls.find(([p]: any[]) => p !== null && p !== undefined)
  expect(call, 'expected a promise to be stored in the in-flight slot').toBeDefined()

  return (call as any[])[0] as Promise<any>
}

// Regression suite for the intermittent 500 on GET /api/v1/inventory
// ("TypeError: Cannot read properties of undefined (reading 'clusters')"),
// observed in the field on the first inventory call after a server start.
//
// blockingFetch hands the shared in-flight promise straight back to its
// callers, so whatever triggerBackgroundRevalidation parks there IS what a
// concurrent blocking caller receives. It used to park a Promise<void> (the
// .then returned nothing, the .catch swallowed), through an `as any` that
// defeated the slot's own Promise<CachedInventory> type. The piggybacking
// caller got `undefined` and died dereferencing it.
//
// The window is NOT limited to startup: the stale branch triggers a
// revalidation on every TTL expiry, so a polling monitor could hit this at
// any time.
describe('background revalidation shares a usable promise (inventory 500 regression)', () => {
  it('parks a promise that resolves to the inventory, not to undefined', async () => {
    getInventoryFromCacheMock.mockReturnValue({ status: 'stale', data: RAW })

    await getInventorySWR('default', { kind: 'provider' } as any)

    // THE load-bearing assertion: this awaited to `undefined` before the fix.
    await expect(storedInflightPromise()).resolves.toEqual(RAW)
  })

  it('a blocking caller piggybacking on a running revalidation receives the inventory', async () => {
    // 1) A stale read triggers the revalidation and parks its promise.
    getInventoryFromCacheMock.mockReturnValue({ status: 'stale', data: RAW })
    await getInventorySWR('default', { kind: 'provider' } as any)
    const parked = storedInflightPromise()

    // 2) A second caller finds a cold cache while that revalidation is still
    //    in flight — the exact production sequence, where /api/v1/vms warmed
    //    the cache non-blockingly and /api/v1/inventory arrived right behind.
    getInventoryFromCacheMock.mockReturnValue({ status: 'miss' })
    getInflightFetchMock.mockReturnValue(parked)

    const out = await getInventorySWR('default', { kind: 'provider' } as any)

    expect(out.raw, 'the piggybacking caller must never receive undefined').toBeDefined()
    // The dereference that produced the 500 in the route handler.
    expect(out.raw.clusters).toEqual([])
  })

  it('a FAILING revalidation rejects for the piggybacking caller instead of resolving undefined', async () => {
    getSessionPrismaMock.mockRejectedValue(new Error('proxmox unreachable'))
    getInventoryFromCacheMock.mockReturnValue({ status: 'stale', data: RAW })

    await getInventorySWR('default', { kind: 'provider' } as any)

    // Rejecting is the honest answer: it surfaces the real cause instead of a
    // bogus TypeError further down. The detached handler in
    // triggerBackgroundRevalidation is what keeps this from also becoming an
    // unhandled rejection for the fire-and-forget caller.
    await expect(storedInflightPromise()).rejects.toThrow('proxmox unreachable')
  })
})
