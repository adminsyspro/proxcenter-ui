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

export type CachedInventory = {
  clusters: any[]
  pbsServers: any[]
  externalHypervisors: any[]
  // Written by the inventory stream route: StorageData[], the {connId, nodes[],
  // sharedStorages[]} shape the inventory tree consumes.
  storages?: any[]
  // Written by fetchRawInventory: AggregatedStorage[], the per-storage rollup
  // the metrics exposition reads. A different shape under a different name:
  // the two shared the name `storages` in v1.4.10 and the tree died on it.
  storageResources?: any[]
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

// Version of the CachedInventory payload shape. v1 had `storages` carrying two
// incompatible shapes depending on the writer; v2 separates them. v3 adds
// `pools` on every cluster (issue #978): a v2 entry carries none, and serving
// it would keep hiding the empty pools until its TTL runs out. v4 adds
// `diskTotal` on every guest (#938): a v3 entry would keep showing the boot
// disk alone in the Disk column. Since v4 the stream route also writes
// `storageResources`, and fills a missing `storages` when it serves an entry
// fetchRawInventory wrote: both readers of one key always get their half.
const SCHEMA_VERSION = 4

type CacheEntry = {
  data: CachedInventory
  timestamp: number
  version: number
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
export function inventoryCacheKey(tenantId: string, vdcContext: string | null = null): string {
  return `${tenantId}::${vdcContext ?? 'all'}`
}

// Bumped by every invalidation. A fetch remembers the epoch it started in and
// may only write the cache while it is still current: a read begun before a
// VM action would otherwise land after the invalidation and put the
// pre-action inventory back for the next 15 minutes.
const EPOCH_KEY = '__proxcenter_inventory_epoch__' as const

export function inventoryCacheEpoch(): number {
  return (globalThis as any)[EPOCH_KEY] ?? 0
}

/**
 * Returns the cached inventory with its freshness status.
 *   - `fresh`  → data is recent, no revalidation needed
 *   - `stale`  → data is usable but should be revalidated in background
 *   - `miss`   → no usable data, blocking fetch required
 */
export function getInventoryFromCache(tenantId = 'default', vdcContext: string | null = null): CacheResult {
  const store = getCacheStore()
  const entry = store.get(inventoryCacheKey(tenantId, vdcContext))
  if (!entry) return { status: 'miss' }

  // A payload shape change must never be served to a process that expects the
  // new one: entries written by an older build are discarded here rather than
  // waiting out their TTL. Bump SCHEMA_VERSION whenever CachedInventory changes.
  if (entry.version !== SCHEMA_VERSION) return { status: 'miss' }

  const age = Date.now() - entry.timestamp

  if (age <= FRESH_TTL_MS) {
    return { status: 'fresh', data: entry.data }
  }

  if (age <= STALE_TTL_MS) {
    return { status: 'stale', data: entry.data }
  }

  return { status: 'miss' }
}

/** `epoch`: the one the fetch started in; the write is dropped when the cache
 *  was invalidated since. */
export function setCachedInventory(data: CachedInventory, tenantId = 'default', vdcContext: string | null = null, epoch?: number): void {
  if (epoch !== undefined && epoch !== inventoryCacheEpoch()) return
  const store = getCacheStore()
  store.set(inventoryCacheKey(tenantId, vdcContext), { data, timestamp: Date.now(), version: SCHEMA_VERSION })
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
  ;(globalThis as any)[EPOCH_KEY] = inventoryCacheEpoch() + 1
  // The fetches in flight keep running for whoever awaits them, but new
  // readers must not join them: they started before the change.
  for (const store of [getCacheStore(), getInflightStore()] as Map<string, unknown>[]) {
    if (tenantId) {
      const prefix = `${tenantId}::`
      for (const key of store.keys()) {
        if (key.startsWith(prefix)) store.delete(key)
      }
    } else {
      store.clear()
    }
  }
}

/**
 * Returns the in-flight fetch promise if one is already running for the given tenant,
 * or null if the caller should start a new fetch.
 * This prevents multiple simultaneous requests from all hitting Proxmox.
 */
export function getInflightFetch(tenantId = 'default', vdcContext: string | null = null): Promise<CachedInventory> | null {
  return getInflightStore().get(inventoryCacheKey(tenantId, vdcContext)) ?? null
}

export function setInflightFetch(p: Promise<CachedInventory> | null, tenantId = 'default', vdcContext: string | null = null): void {
  const store = getInflightStore()
  const key = inventoryCacheKey(tenantId, vdcContext)
  if (p !== null) {
    store.set(key, p)
  } else {
    store.delete(key)
  }
}

/** Frees the slot only if it still holds `p`: a fetch that ends after an
 *  invalidation or a forced refresh must not drop the newer one. */
export function clearInflightFetch(p: Promise<CachedInventory>, tenantId = 'default', vdcContext: string | null = null): void {
  const store = getInflightStore()
  const key = inventoryCacheKey(tenantId, vdcContext)
  if (store.get(key) === p) store.delete(key)
}
