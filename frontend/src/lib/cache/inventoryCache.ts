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
 */

type CachedInventory = {
  clusters: any[]
  pbsServers: any[]
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

function getCache(): CacheEntry | null {
  return (globalThis as any)[CACHE_KEY] ?? null
}

function setCache(entry: CacheEntry) {
  ;(globalThis as any)[CACHE_KEY] = entry
}

// Lock to prevent concurrent fetches (thundering herd)
let fetchInProgress: Promise<CachedInventory> | null = null

type CacheResult =
  | { status: 'fresh'; data: CachedInventory }
  | { status: 'stale'; data: CachedInventory }
  | { status: 'miss' }

/**
 * Returns the cached inventory with its freshness status.
 *   - `fresh`  → data is recent, no revalidation needed
 *   - `stale`  → data is usable but should be revalidated in background
 *   - `miss`   → no usable data, blocking fetch required
 */
export function getInventoryFromCache(): CacheResult {
  const entry = getCache()
  if (!entry) return { status: 'miss' }

  const age = Date.now() - entry.timestamp

  if (age <= FRESH_TTL_MS) {
    return { status: 'fresh', data: entry.data }
  }

  if (age <= STALE_TTL_MS) {
    return { status: 'stale', data: entry.data }
  }

  return { status: 'miss' }
}

export function setCachedInventory(data: CachedInventory): void {
  setCache({ data, timestamp: Date.now() })
}

export function invalidateInventoryCache(): void {
  ;(globalThis as any)[CACHE_KEY] = null
}

/**
 * Returns the in-flight fetch promise if one is already running,
 * or null if the caller should start a new fetch.
 * This prevents multiple simultaneous requests from all hitting Proxmox.
 */
export function getInflightFetch(): Promise<CachedInventory> | null {
  return fetchInProgress
}

export function setInflightFetch(p: Promise<CachedInventory> | null): void {
  fetchInProgress = p
}
