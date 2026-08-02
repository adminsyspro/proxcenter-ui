// Extracted from src/app/api/v1/pbs/[id]/backups/route.ts:25-186 (spec D12):
// the per-PBS snapshot fan-out and its stale-while-revalidate wrapper, so the
// fleet-wide freshness aggregation and the PBS route share ONE implementation.
import { pbsFetch } from "@/lib/proxmox/pbs-client"
import { formatBytes } from "@/utils/format"
import {
  type CachedBackup,
  getPbsBackupsFromCache,
  setCachedPbsBackups,
  getInflightPbsFetch,
  setInflightPbsFetch,
} from "@/lib/cache/pbsBackupCache"

export type { CachedBackup }

/**
 * Fetch ALL snapshots from a PBS connection (all datastores, all namespaces).
 * This is the expensive operation we want to cache.
 */
export async function fetchAllPbsBackups(
  conn: any,
  dateLocale: string,
): Promise<{ data: CachedBackup[]; warnings: string[] }> {
  const datastores = await pbsFetch<any[]>(conn, "/admin/datastore")
  const allBackups: CachedBackup[] = []
  const warnings: string[] = []

  const datastorePromises = datastores.map(async (ds) => {
    const storeName = ds.store || ds.name
    if (!storeName) return []

    try {
      // List all namespaces (empty string = root, plus any sub-namespaces)
      let namespaces: string[] = ['']

      try {
        const nsData = await pbsFetch<any[]>(
          conn,
          `/admin/datastore/${encodeURIComponent(storeName)}/namespace`
        )

        if (Array.isArray(nsData)) {
          const subNs = nsData.map(n => n.ns || '').filter(Boolean)
          namespaces = ['', ...subNs]
        }
      } catch {
        // Older PBS versions may not support namespace endpoint — use root only
      }

      // Fetch snapshots for each namespace in parallel
      const nsPromises = namespaces.map(async (ns) => {
        const nsParam = ns ? `?ns=${encodeURIComponent(ns)}` : ''
        const snapshots = await pbsFetch<any[]>(
          conn,
          `/admin/datastore/${encodeURIComponent(storeName)}/snapshots${nsParam}`
        )

        return (snapshots || []).map(snap => {
          const backupTime = snap['backup-time']
            ? new Date(snap['backup-time'] * 1000)
            : null

          const vmName = snap.comment || ''

          return {
            id: `${storeName}/${ns ? ns + '/' : ''}${snap['backup-type']}/${snap['backup-id']}/${snap['backup-time']}`,
            datastore: storeName,
            namespace: ns,
            backupType: snap['backup-type'],
            backupId: snap['backup-id'],
            vmName: vmName,
            backupTime: snap['backup-time'] || 0,
            backupTimeFormatted: backupTime?.toLocaleString(dateLocale) || '-',
            backupTimeIso: backupTime?.toISOString() || '',

            // Taille
            size: snap.size || 0,
            sizeFormatted: formatBytes(snap.size || 0),

            // Fichiers
            files: snap.files || [],
            fileCount: snap.files?.length || 0,

            // Vérification
            verification: snap.verification || null,
            verified: snap.verification?.state === 'ok',
            verifiedAt: snap.verification?.upid
              ? new Date((snap.verification['last-run'] || 0) * 1000).toLocaleString(dateLocale)
              : null,

            // Protection
            protected: snap.protected || false,

            // Owner
            owner: snap.owner || '',
            comment: snap.comment || '',
          } as CachedBackup
        })
      })

      const nsResults = await Promise.all(nsPromises)
      return nsResults.flat()
    } catch (e: any) {
      console.warn(`Failed to get snapshots for datastore ${storeName}:`, e)
      warnings.push(`Failed to fetch datastore '${storeName}': ${e?.message || String(e)}`)
      return []
    }
  })

  const results = await Promise.all(datastorePromises)
  results.forEach(backups => allBackups.push(...backups))

  // Pre-sort by date (most recent first) so cached data is already sorted
  allBackups.sort((a, b) => b.backupTime - a.backupTime)

  return { data: allBackups, warnings }
}

/**
 * Get all backups for a PBS connection, using cache with stale-while-revalidate.
 * Returns cached data when available, triggers background refresh when stale.
 */
export async function getAllBackups(
  id: string,
  conn: any,
  tenantId = 'default',
  dateLocale = 'en-US',
): Promise<{ data: CachedBackup[]; warnings: string[]; fromCache: boolean }> {
  const cached = getPbsBackupsFromCache(id, tenantId, dateLocale)

  if (cached.status === 'fresh') {
    return { data: cached.data, warnings: cached.warnings, fromCache: true }
  }

  if (cached.status === 'stale') {
    // Serve stale data immediately, refresh in background
    const existing = getInflightPbsFetch(id, tenantId, dateLocale)
    if (existing === null) {
      const refreshPromise = fetchAllPbsBackups(conn, dateLocale)
        .then(result => {
          setCachedPbsBackups(id, result.data, result.warnings, tenantId, dateLocale)
          return result
        })
        .catch(err => {
          console.warn(`Background PBS backup refresh failed for ${id}:`, err)
          return { data: cached.data, warnings: cached.warnings }
        })
        .finally(() => {
          setInflightPbsFetch(null, id, tenantId, dateLocale)
        })

      setInflightPbsFetch(refreshPromise, id, tenantId, dateLocale)
    }

    return { data: cached.data, warnings: cached.warnings, fromCache: true }
  }

  // Cache miss — blocking fetch required (but deduplicate concurrent requests)
  let inflight = getInflightPbsFetch(id, tenantId, dateLocale)
  if (inflight !== null) {
    const result = await inflight
    return { data: result.data, warnings: result.warnings, fromCache: false }
  }

  const fetchPromise = fetchAllPbsBackups(conn, dateLocale)
    .then(result => {
      setCachedPbsBackups(id, result.data, result.warnings, tenantId, dateLocale)
      return result
    })
    .finally(() => {
      setInflightPbsFetch(null, id, tenantId, dateLocale)
    })

  setInflightPbsFetch(fetchPromise, id, tenantId, dateLocale)
  const result = await fetchPromise
  return { data: result.data, warnings: result.warnings, fromCache: false }
}
