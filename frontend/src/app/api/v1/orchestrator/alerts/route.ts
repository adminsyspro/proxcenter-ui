import { NextResponse } from 'next/server'

import { alertsApi } from '@/lib/orchestrator/client'
import { demoResponse } from '@/lib/demo/demo-api'
import { DEFAULT_TENANT_ID, getCurrentTenantId, getSessionPrisma, getTenantConnectionIds } from '@/lib/tenant'
import { getTenantInfrastructureScope, maskingScope } from '@/lib/tenant/infraScope'
import { checkPermission, PERMISSIONS, getCurrentRbacInfraScope } from '@/lib/rbac'
import { isAlertVisibleToTenant } from '@/lib/alerts/visibility'
import { getVdcVmidsByConnection } from '@/lib/alerts/vdcVmids'
import { clearVisibleTenantAlerts } from '@/lib/alerts/clearVisible'
import { buildOrchestratorFingerprint } from '@/lib/alerts/orchestratorFingerprint'
import {
  dedupeOrchestratorAlerts,
  fetchOrchestratorAlerts,
  type OrchestratorAlertStatus,
} from '@/lib/alerts/orchestratorAlertFeed'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ORCHESTRATOR_STATUSES: OrchestratorAlertStatus[] = ['active', 'acknowledged', 'resolved']

/**
 * GET /api/v1/orchestrator/alerts
 * Récupère les alertes depuis l'orchestrator, filtrées par tenant
 */
export async function GET(req: Request) {
  const demo = demoResponse(req)
  if (demo) return demo

  try {
    // CONNECTION_VIEW baseline (same as /api/v1/changes): vDC tenants don't
    // necessarily carry alerts.view in their default role but they need to
    // see alerts on their own resources. Tenant scoping is enforced by the
    // tenantConnectionIds + vdcScope filters below.
    const denied = await checkPermission(PERMISSIONS.CONNECTION_VIEW)
    if (denied) return denied

    const { searchParams } = new URL(req.url)
    const connectionId = searchParams.get('connection_id') || undefined
    const status = searchParams.get('status') || undefined
    const limit = searchParams.get('limit') ? Number.parseInt(searchParams.get('limit')!) : 100
    const offset = searchParams.get('offset') ? Number.parseInt(searchParams.get('offset')!) : 0

    // Reachable connections = directly owned ∪ vDC-bound. Going through
    // the helper instead of the inline prisma.connection query so MSP
    // tenants (who own no connections directly, only vDC bindings) get
    // their alerts populated. Same fix as /api/v1/changes.
    const prisma = await getSessionPrisma()
    const tenantConnectionIds = await getTenantConnectionIds()
    const tenantId = await getCurrentTenantId()
    // For vDC tenants on multi-tenant clusters, drop non-VM alerts (node /
    // license / cluster-wide system alerts are provider concerns) and apply
    // node-level scoping so neighbour activity doesn't leak.
    const infra = await getTenantInfrastructureScope(tenantId)
    const vdcScope = maskingScope(infra)

    // Each status is fetched on its own: open alerts in full, resolved ones
    // as recent history. A single window of the newest rows of any status
    // dropped old open alerts that the bell and the summary still counted (#1086).
    // "silenced" is a label added below, so it needs every status.
    const statuses: OrchestratorAlertStatus[] = status && ORCHESTRATOR_STATUSES.includes(status as OrchestratorAlertStatus)
      ? [status as OrchestratorAlertStatus]
      : ORCHESTRATOR_STATUSES

    // Filter alerts: rule ownership AND resource scope. Both gates must
    // pass — a tenant-owned rule that fires on a neighbour tenant's node
    // (orchestrator is not tenant-aware) would otherwise leak through.
    const allAlerts = await fetchOrchestratorAlerts(statuses, { connectionId })
    const vdcVmids = vdcScope ? await getVdcVmidsByConnection(tenantId) : undefined
    // Caller's RBAC infra scope (issue #525), honoured inside isAlertVisibleToTenant.
    const rbacScope = await getCurrentRbacInfraScope(PERMISSIONS.CONNECTION_VIEW)
    const visibilityCtx = { tenantId, tenantConnectionIds, vdcScope, vdcVmids, infraKind: infra.kind, rbacScope }
    // isAlertVisibleToTenant became async in the Postgres cutover; resolve
    // each alert's visibility up-front before filtering, otherwise the
    // filter sees a Promise (truthy) and lets every alert through.
    let filtered = allAlerts
    if (Array.isArray(allAlerts)) {
      const visible = await Promise.all(
        allAlerts.map((a: any) => isAlertVisibleToTenant(a, visibilityCtx)),
      )
      filtered = allAlerts.filter((_: any, i: number) => visible[i])
    }

    // Load active silences for this tenant (graceful fallback if table doesn't exist yet)
    const now = new Date()
    let silenceMap = new Map<string, any>()

    try {
      const silences = await prisma.alertSilence.findMany({
        where: {
          OR: [
            { silencedUntil: null },
            { silencedUntil: { gt: now } },
          ],
        },
      })

      silenceMap = new Map(silences.map(s => [s.fingerprint, s]))

      // Clean up expired silences in the background
      prisma.alertSilence.deleteMany({
        where: {
          silencedUntil: { not: null, lte: now },
        },
      }).catch(() => {})
    } catch {
      // Table may not exist yet — continue without silence annotations
    }

    // Annotate alerts with silence state
    const annotated = Array.isArray(filtered)
      ? filtered.map((a: any) => {
          const fp = buildOrchestratorFingerprint(a)
          const silence = silenceMap.get(fp)
          if (silence) {
            return {
              ...a,
              status: 'silenced',
              silenced_until: silence.silencedUntil?.toISOString() || null,
              silenced_by: silence.silencedBy,
              _original_status: a.status,
              _fingerprint: fp,
            }
          }
          return { ...a, _fingerprint: fp }
        })
      : filtered

    // Deduplicate by fingerprint and orchestrator status: keep only the most
    // recent entry per unique alert, without letting an older resolved
    // occurrence hide one that is still active.
    const deduped = Array.isArray(annotated)
      ? dedupeOrchestratorAlerts(annotated, (a: any) => a._fingerprint, (a: any) => a._original_status || a.status)
      : annotated

    // Apply post-annotation status filter (e.g. ?status=active should exclude silenced)
    const finalFiltered = Array.isArray(deduped) && status
      ? deduped.filter((a: any) => a.status === status)
      : deduped

    // Open alerts first, newest first: a page cut never pushes an open alert
    // out behind resolved history.
    const isResolved = (a: any) => ((a._original_status || a.status) === 'resolved' ? 1 : 0)
    const sorted = Array.isArray(finalFiltered)
      ? [...finalFiltered].sort((a: any, b: any) =>
          isResolved(a) - isResolved(b) ||
          new Date(b.last_seen_at || 0).getTime() - new Date(a.last_seen_at || 0).getTime())
      : finalFiltered
    const sliced = Array.isArray(sorted) ? sorted.slice(offset, offset + limit) : sorted

    return NextResponse.json({
      data: sliced,
      total: Array.isArray(sorted) ? sorted.length : 0,
      limit,
      offset,
    })
  } catch (error: any) {
    if ((error as any)?.code !== 'ORCHESTRATOR_UNAVAILABLE') {
      console.error('[orchestrator/alerts] GET error:', error)
    }
    
    // Si l'orchestrator n'est pas disponible, retourner une liste vide
    if (error.message?.includes('ECONNREFUSED') || error.message?.includes('timeout')) {
      return NextResponse.json({
        data: [],
        total: 0,
        limit: 100,
        offset: 0,
        error: 'Orchestrator unavailable'
      })
    }

    return NextResponse.json(
      { error: error?.message || 'Failed to fetch alerts' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/v1/orchestrator/alerts
 * Efface toutes les alertes actives (scoped to tenant connections)
 */
export async function DELETE(req: Request) {
  const demo = demoResponse(req)
  if (demo) return demo

  try {
    const denied = await checkPermission(PERMISSIONS.ALERTS_MANAGE)
    if (denied) return denied

    const { searchParams } = new URL(req.url)
    const connectionId = searchParams.get('connection_id') || undefined

    // Task 12 Step 5 (confirmed): the orchestrator's clearAll has no tenant
    // concept -- omitting connection_id wipes the ENTIRE fleet's active
    // alerts. A non-provider caller must supply a connection_id in their own
    // perimeter; the provider keeps the unrestricted fleet-wide clear.
    const tenantId = await getCurrentTenantId()
    if (tenantId !== DEFAULT_TENANT_ID && !connectionId) {
      return NextResponse.json({ error: 'connection_id is required' }, { status: 400 })
    }

    // Verify connection belongs to tenant if specified
    if (connectionId) {
      const tenantConnectionIds = await getTenantConnectionIds()
      if (!tenantConnectionIds.has(connectionId)) {
        return NextResponse.json({ error: 'Connection not found' }, { status: 404 })
      }
    }

    // Non-provider: the orchestrator's clearAll(connection) has no tenant
    // concept — on a shared cluster it would wipe the neighbours' alerts
    // too. Clear only the alerts this caller can actually see, one by one.
    if (tenantId !== DEFAULT_TENANT_ID) {
      const cleared = await clearVisibleTenantAlerts(connectionId)

      return NextResponse.json({ cleared })
    }

    const response = await alertsApi.clearAll(connectionId)

    return NextResponse.json(response.data)
  } catch (error: any) {
    if ((error as any)?.code !== 'ORCHESTRATOR_UNAVAILABLE') {
      console.error('[orchestrator/alerts] DELETE error:', error)
    }

    return NextResponse.json(
      { error: error?.message || 'Failed to clear alerts' },
      { status: 500 }
    )
  }
}
