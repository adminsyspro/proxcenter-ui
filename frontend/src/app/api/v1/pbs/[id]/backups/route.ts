import { NextResponse } from "next/server"
import { cookies } from "next/headers"

import { demoResponse } from "@/lib/demo/demo-api"
import { getPbsConnectionById, getPbsConnectionByIdUnscoped, getConnectionById } from "@/lib/connections/getConnection"
import { pveFetch } from "@/lib/proxmox/client"
import { prisma as globalPrisma } from "@/lib/db/prisma"
import { getSessionPrisma } from "@/lib/tenant"
import { formatBytes } from "@/utils/format"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { assertVdcPbsAccess, getVdcScope } from "@/lib/vdc/scope"
import { getDateLocale } from "@/lib/i18n/date"
import { getCurrentTenantId } from "@/lib/tenant"
import { setCachedPbsBackups } from "@/lib/cache/pbsBackupCache"
import { fetchAllPbsBackups, getAllBackups, type CachedBackup } from "@/lib/backups/pbsSnapshots"
import { withPublicApiGuard, type GuardedRouteContext } from "@/lib/api-tokens/routeGuard"

export const runtime = "nodejs"

// Connection perimeter for THIS route is layered elsewhere on purpose (spec
// section 6): layer 1 is the guard itself, which validates the {id} segment
// (declared as the entry's connectionSegment) against
// resolveVisibleConnectionIds(principal) BEFORE this handler ever runs;
// layer 2 is the existing checkPermission(BACKUP_VIEW, "pbs", id) call
// below, already principal-aware since Task 9. Nothing else changes here.
async function handler(req: Request, ctx: GuardedRouteContext) {
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

    // P1<->P1.5 seam: the union access VERDICT above stays untouched, but the
    // DISPLAYED namespaces must follow the active vDC view context — otherwise
    // the list here still shows vDC-B namespaces while the restore dialog
    // hides its selector and locks the target to vDC A, and a restore can
    // silently target the wrong vDC. Token callers never depend on the
    // cookie (global ruling n°4); the 5s memo makes this second resolution
    // of the scope cheap.
    const tenantId = await getCurrentTenantId()
    const narrowed = await getVdcScope(tenantId, { ignoreVdcContext: ctx?.principal?.kind === 'token' })

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
    // The union access list is the outer authorization bound; intersecting
    // with the context-narrowed scope can only REMOVE entries from it, never
    // add ones the union verdict didn't already authorise. A no-op when no
    // view context is set (narrowed == union).
    if (access.kind === 'tenant') {
      const allowedSet = new Set(access.allowed.map(p => `${p.datastore}|${p.namespace}`))
      const narrowedNs = narrowed?.pbsNamespacesByConnection.get(id) ?? []
      const narrowedSet = new Set(narrowedNs.map(p => `${p.datastore}|${p.namespace}`))
      allBackups = allBackups.filter(b =>
        allowedSet.has(`${b.datastore}|${b.namespace}`) && narrowedSet.has(`${b.datastore}|${b.namespace}`)
      )
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
        // Reuse the already-resolved `narrowed` scope (list and enrichment
        // must agree on which vDC view context they're rendering).
        const sessionPrisma = await getSessionPrisma()
        const connPrisma = narrowed ? globalPrisma : sessionPrisma
        const pveWhere: any = { type: 'pve' }
        if (narrowed) pveWhere.id = { in: [...narrowed.connectionIds] }
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

export const GET = withPublicApiGuard("pbs-backups", handler)
