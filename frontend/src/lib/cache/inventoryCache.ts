/**
 * In-memory server-side cache for inventory data.
 *
 * Uses a **stale-while-revalidate** strategy:
 *   - FRESH  (< FRESH_TTL):  serve directly, no fetch
 *   - STALE  (< STALE_TTL):  serve immediately, trigger background refresh
 *   - EXPIRED (> STALE_TTL): discard, blocking fetch required
 *
 * Stores the RAW inventory (before RBAC filtering) so that the expensive
 * Proxmox API calls are not repeated on every request.
 * RBAC filtering is applied AFTER cache retrieval — each user still gets
 * their own filtered view.
 *
 * The cache lives in the Node.js process memory and is shared across all
 * requests.  A module-level singleton is used so that Next.js hot-reload
 * does not reset it in production.
 *
 * Cache is keyed by tenantId to ensure tenant isolation.
 */

type CachedInventory = {
  clusters: any[]
  pbsServers: any[]
  externalHypervisors: any[]
  storages: any[]
  stats: {
    totalClusters: number
    totalNodes: number
    totalGuests: number
    onlineNodes: number
    runningGuests: number
    totalPbsServers: number
    totalDatastores: number
    totalBackups: number
  }
}

type CacheEntry = {
  data: CachedInventory
  timestamp: number
}

/** Data is considered fresh for 2 minutes — served without revalidation */
const FRESH_TTL_MS = 2 * 60 * 1_000 // 2 minutes

/** Data is usable (stale) for up to 15 minutes — served while revalidating in background */
const STALE_TTL_MS = 15 * 60 * 1_000 // 15 minutes

// Use globalThis to survive Next.js hot-reload in development
const CACHE_KEY = '__proxcenter_inventory_cache__' as const

function getCacheStore(): Map<string, CacheEntry> {
  if (!(globalThis as any)[CACHE_KEY]) {
    ;(globalThis as any)[CACHE_KEY] = new Map<string, CacheEntry>()
  }
  return (globalThis as any)[CACHE_KEY]
}

// Lock to prevent concurrent fetches per tenant (thundering herd)
const INFLIGHT_KEY = '__proxcenter_inventory_inflight__' as const

function getInflightStore(): Map<string, Promise<CachedInventory>> {
  if (!(globalThis as any)[INFLIGHT_KEY]) {
    ;(globalThis as any)[INFLIGHT_KEY] = new Map<string, Promise<CachedInventory>>()
  }
  return (globalThis as any)[INFLIGHT_KEY]
}

type CacheResult =
  | { status: 'fresh'; data: CachedInventory }
  | { status: 'stale'; data: CachedInventory }
  | { status: 'miss' }

/** Composite cache key: `${tenantId}::${vdcContext ?? 'all'}`. The vDC view
 *  context is part of the identity of a cached payload — a narrowed
 *  inventory must never be served to the union view (or vice-versa). */
function cacheKey(tenantId: string, vdcContext: string | null = null): string {
  return `${tenantId}::${vdcContext ?? 'all'}`
}

/**
 * Returns the cached inventory with its freshness status.
 *   - `fresh`  → data is recent, no revalidation needed
 *   - `stale`  → data is usable but should be revalidated in background
 *   - `miss`   → no usable data, blocking fetch required
 */
export function getInventoryFromCache(tenantId = 'default', vdcContext: string | null = null): CacheResult {
  const store = getCacheStore()
  const entry = store.get(cacheKey(tenantId, vdcContext))
  if (!entry) return { status: 'miss' }

  // Invalidate cache entries missing required fields (e.g. storages added later)
  if (!entry.data.storages) return { status: 'miss' }

  const age = Date.now() - entry.timestamp

  if (age <= FRESH_TTL_MS) {
    return { status: 'fresh', data: entry.data }
  }

  if (age <= STALE_TTL_MS) {
    return { status: 'stale', data: entry.data }
  }

  return { status: 'miss' }
}

export function setCachedInventory(data: CachedInventory, tenantId = 'default', vdcContext: string | null = null): void {
  const store = getCacheStore()
  store.set(cacheKey(tenantId, vdcContext), { data, timestamp: Date.now() })
}

/**
 * Every cached inventory of a tenant across all vDC contexts, freshest
 * first (fresh-or-stale only). For consumers whose derived data is
 * context-independent (per-VM meta): a narrowed entry holds a subset of
 * the tenant's guests, so merging entries adds coverage and can never
 * leak across tenants (the prefix is tenant-scoped).
 */
export function getTenantInventoriesFromCache(tenantId: string): CachedInventory[] {
  const prefix = `${tenantId}::`
  const hits: Array<{ entry: CacheEntry }> = []
  for (const [key, entry] of getCacheStore()) {
    if (!key.startsWith(prefix)) continue
    if (Date.now() - entry.timestamp > STALE_TTL_MS) continue
    hits.push({ entry })
  }
  return hits.sort((a, b) => b.entry.timestamp - a.entry.timestamp).map(h => h.entry.data)
}

export function invalidateInventoryCache(tenantId?: string): void {
  const store = getCacheStore()
  if (tenantId) {
    const prefix = `${tenantId}::`
    for (const key of store.keys()) {
      if (key.startsWith(prefix)) store.delete(key)
    }
  } else {
    store.clear()
  }
}

/**
 * Returns the in-flight fetch promise if one is already running for the given tenant,
 * or null if the caller should start a new fetch.
 * This prevents multiple simultaneous requests from all hitting Proxmox.
 */
export function getInflightFetch(tenantId = 'default', vdcContext: string | null = null): Promise<CachedInventory> | null {
  return getInflightStore().get(cacheKey(tenantId, vdcContext)) ?? null
}

export function setInflightFetch(p: Promise<CachedInventory> | null, tenantId = 'default', vdcContext: string | null = null): void {
  const store = getInflightStore()
  const key = cacheKey(tenantId, vdcContext)
  if (p !== null) {
    store.set(key, p)
  } else {
    store.delete(key)
  }
}
