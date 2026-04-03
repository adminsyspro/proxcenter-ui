import { NextResponse } from "next/server"

import { demoResponse } from "@/lib/demo/demo-api"
import { pbsFetch } from "@/lib/proxmox/pbs-client"
import { getPbsConnectionById } from "@/lib/connections/getConnection"
import { formatBytes } from "@/utils/format"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import {
  type CachedBackup,
  getPbsBackupsFromCache,
  setCachedPbsBackups,
  getInflightPbsFetch,
  setInflightPbsFetch,
} from "@/lib/cache/pbsBackupCache"

export const runtime = "nodejs"

/**
 * Fetch ALL snapshots from a PBS connection (all datastores, all namespaces).
 * This is the expensive operation we want to cache.
 */
async function fetchAllPbsBackups(
  conn: any,
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
            backupTimeFormatted: backupTime?.toLocaleString('fr-FR') || '-',
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
              ? new Date((snap.verification['last-run'] || 0) * 1000).toLocaleString('fr-FR')
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
async function getAllBackups(
  id: string,
  conn: any,
  tenantId = 'default'
): Promise<{ data: CachedBackup[]; warnings: string[]; fromCache: boolean }> {
  const cached = getPbsBackupsFromCache(id, tenantId)

  if (cached.status === 'fresh') {
    return { data: cached.data, warnings: cached.warnings, fromCache: true }
  }

  if (cached.status === 'stale') {
    // Serve stale data immediately, refresh in background
    const existing = getInflightPbsFetch(id, tenantId)
    if (existing === null) {
      const refreshPromise = fetchAllPbsBackups(conn)
        .then(result => {
          setCachedPbsBackups(id, result.data, result.warnings, tenantId)
          return result
        })
        .catch(err => {
          console.warn(`Background PBS backup refresh failed for ${id}:`, err)
          return { data: cached.data, warnings: cached.warnings }
        })
        .finally(() => {
          setInflightPbsFetch(null, id, tenantId)
        })

      setInflightPbsFetch(refreshPromise, id, tenantId)
    }

    return { data: cached.data, warnings: cached.warnings, fromCache: true }
  }

  // Cache miss — blocking fetch required (but deduplicate concurrent requests)
  let inflight = getInflightPbsFetch(id, tenantId)
  if (inflight !== null) {
    const result = await inflight
    return { data: result.data, warnings: result.warnings, fromCache: false }
  }

  const fetchPromise = fetchAllPbsBackups(conn)
    .then(result => {
      setCachedPbsBackups(id, result.data, result.warnings, tenantId)
      return result
    })
    .finally(() => {
      setInflightPbsFetch(null, id, tenantId)
    })

  setInflightPbsFetch(fetchPromise, id, tenantId)
  const result = await fetchPromise
  return { data: result.data, warnings: result.warnings, fromCache: false }
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> | { id: string } }) {
  const demo = demoResponse(req)
  if (demo) return demo

  try {
    const params = await Promise.resolve(ctx.params)
    const id = (params as any)?.id

    if (!id) return NextResponse.json({ error: "Missing params.id" }, { status: 400 })

    const denied = await checkPermission(PERMISSIONS.BACKUP_VIEW, "pbs", id)
    if (denied) return denied

    const url = new URL(req.url)
    const datastoreFilter = url.searchParams.get('datastore')
    const namespaceFilter = url.searchParams.get('namespace') // exact namespace string, '' for root
    const typeFilter = url.searchParams.get('type') // 'vm' | 'ct' | 'host'
    const page = Number.parseInt(url.searchParams.get('page') || '1', 10)
    const pageSize = Number.parseInt(url.searchParams.get('pageSize') || '50', 10)
    const search = url.searchParams.get('search')?.toLowerCase() || ''
    const noCache = url.searchParams.get('noCache') === '1'

    const conn = await getPbsConnectionById(id)

    // Get all backups (from cache or fresh fetch)
    let allBackups: CachedBackup[]
    let warnings: string[]
    let fromCache: boolean

    if (noCache) {
      // Force refresh requested
      const result = await fetchAllPbsBackups(conn)
      setCachedPbsBackups(id, result.data, result.warnings)
      allBackups = result.data
      warnings = result.warnings
      fromCache = false
    } else {
      const result = await getAllBackups(id, conn)
      allBackups = result.data
      warnings = result.warnings
      fromCache = result.fromCache
    }

    // Extract available namespaces from all backups (before filtering)
    const namespaceSet = new Set(allBackups.map(b => b.namespace))
    const namespaces = Array.from(namespaceSet).sort((a, b) => {
      // Root namespace first, then alphabetical
      if (a === '') return -1
      if (b === '') return 1
      return a.localeCompare(b)
    })

    // Apply filters on cached data (fast, in-memory)

    // Filter by datastore
    let filteredBackups = datastoreFilter
      ? allBackups.filter(b => b.datastore === datastoreFilter)
      : allBackups

    // Filter by namespace
    if (namespaceFilter !== null) {
      filteredBackups = filteredBackups.filter(b => b.namespace === namespaceFilter)
    }

    // Filter by type
    if (typeFilter) {
      filteredBackups = filteredBackups.filter(b => b.backupType === typeFilter)
    }

    // Filter by search (ID, VM name, datastore, comment)
    if (search) {
      filteredBackups = filteredBackups.filter(b =>
        b.backupId?.toLowerCase().includes(search) ||
        b.vmName?.toLowerCase().includes(search) ||
        b.datastore?.toLowerCase().includes(search) ||
        b.namespace?.toLowerCase().includes(search) ||
        b.comment?.toLowerCase().includes(search)
      )
    }

    // Stats (before pagination)
    const totalSize = filteredBackups.reduce((sum, b) => sum + (b.size || 0), 0)

    const stats = {
      total: filteredBackups.length,
      vmCount: filteredBackups.filter(b => b.backupType === 'vm').length,
      ctCount: filteredBackups.filter(b => b.backupType === 'ct').length,
      hostCount: filteredBackups.filter(b => b.backupType === 'host').length,
      totalSize,
      totalSizeFormatted: formatBytes(totalSize),
      verifiedCount: filteredBackups.filter(b => b.verified).length,
      protectedCount: filteredBackups.filter(b => b.protected).length,
    }

    // Pagination
    const totalPages = Math.ceil(filteredBackups.length / pageSize)
    const startIndex = (page - 1) * pageSize
    const paginatedBackups = filteredBackups.slice(startIndex, startIndex + pageSize)

    return NextResponse.json({
      data: {
        backups: paginatedBackups,
        namespaces,
        stats,
        warnings,
        fromCache,
        pagination: {
          page,
          pageSize,
          totalPages,
          totalItems: filteredBackups.length,
          hasNext: page < totalPages,
          hasPrev: page > 1,
        }
      }
    })
  } catch (e: any) {
    console.error("PBS backups error:", e)

return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
