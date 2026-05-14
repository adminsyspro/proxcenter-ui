import { NextResponse } from "next/server"
import { cookies } from "next/headers"

import { demoResponse } from "@/lib/demo/demo-api"
import { pbsFetch } from "@/lib/proxmox/pbs-client"
import { getPbsConnectionById, getPbsConnectionByIdUnscoped, getConnectionById } from "@/lib/connections/getConnection"
import { pveFetch } from "@/lib/proxmox/client"
import { prisma as globalPrisma } from "@/lib/db/prisma"
import { getSessionPrisma , getCurrentTenantId } from "@/lib/tenant"
import { formatBytes } from "@/utils/format"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { assertVdcPbsAccess, getVdcScope } from "@/lib/vdc/scope"
import { getDateLocale } from "@/lib/i18n/date"
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
async function getAllBackups(
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

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> | { id: string } }) {
  const demo = demoResponse(req)

  if (demo) return demo

  try {
    const params = await Promise.resolve(ctx.params)
    const id = (params as any)?.id

    if (!id) return NextResponse.json({ error: "Missing params.id" }, { status: 400 })

    const denied = await checkPermission(PERMISSIONS.BACKUP_VIEW, "pbs", id)

    if (denied) return denied

    const access = await assertVdcPbsAccess(id)

    if (access instanceof Response) return access

    const cookieStore = await cookies()
    const dateLocale = getDateLocale(cookieStore.get('NEXT_LOCALE')?.value || 'en')

    const url = new URL(req.url)
    const datastoreFilter = url.searchParams.get('datastore')
    const namespaceFilter = url.searchParams.get('namespace') // exact namespace string, '' for root
    const typeFilter = url.searchParams.get('type') // 'vm' | 'ct' | 'host'
    const page = Number.parseInt(url.searchParams.get('page') || '1', 10)
    const pageSize = Number.parseInt(url.searchParams.get('pageSize') || '50', 10)
    const search = url.searchParams.get('search')?.toLowerCase() || ''
    const noCache = url.searchParams.get('noCache') === '1'

    const conn = access.kind === 'admin'
      ? await getPbsConnectionById(id)
      : await getPbsConnectionByIdUnscoped(id)

    // Get all backups (from cache or fresh fetch)
    let allBackups: CachedBackup[]
    let warnings: string[]
    let fromCache: boolean

    if (noCache) {
      // Force refresh requested
      const result = await fetchAllPbsBackups(conn, dateLocale)

      setCachedPbsBackups(id, result.data, result.warnings, 'default', dateLocale)
      allBackups = result.data
      warnings = result.warnings
      fromCache = false
    } else {
      const result = await getAllBackups(id, conn, 'default', dateLocale)

      allBackups = result.data
      warnings = result.warnings
      fromCache = result.fromCache
    }

    // Tenant scoping: restrict to the caller's authorised (datastore, namespace) pairs.
    if (access.kind === 'tenant') {
      const allowedSet = new Set(access.allowed.map(p => `${p.datastore}|${p.namespace}`))

      allBackups = allBackups.filter(b => allowedSet.has(`${b.datastore}|${b.namespace}`))
    }

    // ── vmName enrichment ──
    // PBS only carries the snapshot's `comment` field — which PVE 8+
    // populates with `--notes-template "{{guestname}}"` by default but
    // older clusters / hand-rolled vzdumps leave empty. Cross-reference
    // with /cluster/resources on every PVE connection the caller can see
    // to fill in the human-friendly name when the comment is blank.
    // Single round-trip per PVE connection (cached implicitly by PVE
    // resource cache), not per backup.
    const blankNames = allBackups.some(b => !b.vmName)

    if (blankNames) {
      try {
        const tenantId = await getCurrentTenantId()
        const vdcScope = await getVdcScope(tenantId)
        const sessionPrisma = await getSessionPrisma()
        const connPrisma = vdcScope ? globalPrisma : sessionPrisma
        const pveWhere: any = { type: 'pve' }

        if (vdcScope) pveWhere.id = { in: [...vdcScope.connectionIds] }

        const pveConns = await connPrisma.connection.findMany({
          where: pveWhere,
          select: { id: true, tenantId: true },
        })

        const vmidToName = new Map<number, string>()

        await Promise.all(pveConns.map(async (pc) => {
          try {
            const conn = await getConnectionById(pc.id, pc.tenantId)
            const resources = await pveFetch<any[]>(conn, '/cluster/resources?type=vm')

            for (const r of resources ?? []) {
              const vmidNum = Number(r?.vmid)
              const name = String(r?.name ?? '').trim()

              if (Number.isFinite(vmidNum) && name && !vmidToName.has(vmidNum)) {
                vmidToName.set(vmidNum, name)
              }
            }
          } catch (err: any) {
            // Best-effort: a single unreachable cluster shouldn't blank
            // out the entire backup list.
            console.warn(`[pbs-backups] vmName lookup failed on connection ${pc.id}: ${err?.message ?? err}`)
          }
        }))

        if (vmidToName.size > 0) {
          allBackups = allBackups.map((b) => {
            if (b.vmName) return b
            const vmidNum = Number(b.backupId)
            const resolved = Number.isFinite(vmidNum) ? vmidToName.get(vmidNum) : undefined


return resolved ? { ...b, vmName: resolved } : b
          })
        }
      } catch (err: any) {
        console.warn(`[pbs-backups] vmName enrichment failed: ${err?.message ?? err}`)
      }
    }

    // Extract available namespaces from all backups (before filtering)
    const namespaceSet = new Set(allBackups.map(b => b.namespace))

    const namespaces = Array.from(namespaceSet).sort((a, b) => {
      // Root namespace first, then alphabetical
      if (a === '') return -1
      if (b === '') return 1

return a.localeCompare(b)
    })

    // Resolve the (datastore, namespace) → vDC mapping so the UI can group
    // namespaces by vDC. For tenant callers we restrict to their own vDCs;
    // super-admins see bindings across every tenant on this PBS connection.
    let bindings: Array<{ datastore: string; namespace: string; vdcId: string; vdcName: string; tenantName?: string }> = []

    if (access.kind === 'tenant') {
      const tenantId = await getCurrentTenantId()

      const rows = await globalPrisma.vdcPbsNamespace.findMany({
        where: { pbsConnectionId: id, vdc: { tenantId } },
        select: {
          datastore: true,
          namespace: true,
          vdc: { select: { id: true, name: true } },
        },
      })

      bindings = rows.map(r => ({
        datastore: r.datastore,
        namespace: r.namespace,
        vdcId: r.vdc.id,
        vdcName: r.vdc.name,
      }))
    } else {
      const rows = await globalPrisma.vdcPbsNamespace.findMany({
        where: { pbsConnectionId: id },
        select: {
          datastore: true,
          namespace: true,
          vdc: { select: { id: true, name: true, tenant: { select: { name: true } } } },
        },
      })

      bindings = rows.map(r => ({
        datastore: r.datastore,
        namespace: r.namespace,
        vdcId: r.vdc.id,
        vdcName: r.vdc.name,
        tenantName: r.vdc.tenant?.name ?? undefined,
      }))
    }

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
        bindings,
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
