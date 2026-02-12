/**
 * In-memory server-side cache for inventory data.
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

const DEFAULT_TTL_MS = 30_000 // 30 seconds

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

export function getCachedInventory(ttl: number = DEFAULT_TTL_MS): CachedInventory | null {
  const entry = getCache()
  if (!entry) return null

  const age = Date.now() - entry.timestamp
  if (age > ttl) return null

  return entry.data
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
