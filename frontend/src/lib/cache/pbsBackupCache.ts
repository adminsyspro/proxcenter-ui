/**
 * In-memory server-side cache for PBS backup snapshots.
 *
 * Uses a **stale-while-revalidate** strategy identical to inventoryCache:
 *   - FRESH  (< FRESH_TTL):  serve directly, no fetch
 *   - STALE  (< STALE_TTL):  serve immediately, trigger background refresh
 *   - EXPIRED (> STALE_TTL): discard, blocking fetch required
 *
 * The PBS /snapshots endpoint is slow (reads datastore filesystem) and data
 * rarely changes (backup jobs run hourly at most). Caching avoids re-fetching
 * thousands of snapshots on every page/filter change.
 *
 * Cache is keyed by `tenantId:pbsConnectionId` to ensure isolation.
 */

export type CachedBackup = {
  id: string
  datastore: string
  namespace: string
  backupType: string
  backupId: string
  vmName: string
  backupTime: number
  backupTimeFormatted: string
  backupTimeIso: string
  size: number
  sizeFormatted: string
  files: any[]
  fileCount: number
  verification: any
  verified: boolean
  verifiedAt: string | null
  protected: boolean
  owner: string
  comment: string
}

type CacheEntry = {
  data: CachedBackup[]
  warnings: string[]
  timestamp: number
}

/** Data is considered fresh for 5 minutes — served without revalidation */
const FRESH_TTL_MS = 5 * 60 * 1_000

/** Data is usable (stale) for up to 30 minutes — served while revalidating in background */
const STALE_TTL_MS = 30 * 60 * 1_000

const CACHE_KEY = '__proxcenter_pbs_backup_cache__' as const
const INFLIGHT_KEY = '__proxcenter_pbs_backup_inflight__' as const

function getCacheStore(): Map<string, CacheEntry> {
  if (!(globalThis as any)[CACHE_KEY]) {
    ;(globalThis as any)[CACHE_KEY] = new Map<string, CacheEntry>()
  }
  return (globalThis as any)[CACHE_KEY]
}

function getInflightStore(): Map<string, Promise<{ data: CachedBackup[]; warnings: string[] }>> {
  if (!(globalThis as any)[INFLIGHT_KEY]) {
    ;(globalThis as any)[INFLIGHT_KEY] = new Map()
  }
  return (globalThis as any)[INFLIGHT_KEY]
}

function cacheKey(pbsId: string, tenantId = 'default'): string {
  return `${tenantId}:${pbsId}`
}

type CacheResult =
  | { status: 'fresh'; data: CachedBackup[]; warnings: string[] }
  | { status: 'stale'; data: CachedBackup[]; warnings: string[] }
  | { status: 'miss' }

export function getPbsBackupsFromCache(pbsId: string, tenantId = 'default'): CacheResult {
  const entry = getCacheStore().get(cacheKey(pbsId, tenantId))
  if (!entry) return { status: 'miss' }

  const age = Date.now() - entry.timestamp

  if (age <= FRESH_TTL_MS) {
    return { status: 'fresh', data: entry.data, warnings: entry.warnings }
  }

  if (age <= STALE_TTL_MS) {
    return { status: 'stale', data: entry.data, warnings: entry.warnings }
  }

  return { status: 'miss' }
}

export function setCachedPbsBackups(
  pbsId: string,
  data: CachedBackup[],
  warnings: string[],
  tenantId = 'default'
): void {
  getCacheStore().set(cacheKey(pbsId, tenantId), { data, warnings, timestamp: Date.now() })
}

export function invalidatePbsBackupCache(pbsId?: string, tenantId?: string): void {
  const store = getCacheStore()
  if (pbsId && tenantId) {
    store.delete(cacheKey(pbsId, tenantId))
  } else if (pbsId) {
    // Invalidate all tenants for this PBS
    for (const key of store.keys()) {
      if (key.endsWith(`:${pbsId}`) || key.startsWith(`default:${pbsId}`)) {
        store.delete(key)
      }
    }
  } else {
    store.clear()
  }
}

export function getInflightPbsFetch(
  pbsId: string,
  tenantId = 'default'
): Promise<{ data: CachedBackup[]; warnings: string[] }> | null {
  return getInflightStore().get(cacheKey(pbsId, tenantId)) ?? null
}

export function setInflightPbsFetch(
  p: Promise<{ data: CachedBackup[]; warnings: string[] }> | null,
  pbsId: string,
  tenantId = 'default'
): void {
  const store = getInflightStore()
  const key = cacheKey(pbsId, tenantId)
  if (p) {
    store.set(key, p)
  } else {
    store.delete(key)
  }
}
