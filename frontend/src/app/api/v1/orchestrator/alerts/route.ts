import { NextResponse } from 'next/server'

import { alertsApi } from '@/lib/orchestrator/client'
import { demoResponse } from '@/lib/demo/demo-api'
import { getCurrentTenantId, getSessionPrisma, getTenantConnectionIds } from '@/lib/tenant'
import { getTenantInfrastructureScope, maskingScope } from '@/lib/tenant/infraScope'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { isAlertVisibleToTenant } from '@/lib/alerts/visibility'
import { getVdcVmidsByConnection } from '@/lib/alerts/vdcVmids'
import { buildOrchestratorFingerprint } from '@/lib/alerts/orchestratorFingerprint'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

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
    const status = searchParams.get('status') as 'active' | 'acknowledged' | 'resolved' | undefined
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

    const response = await alertsApi.getAlerts({
      connection_id: connectionId,
      status: status || undefined,
      limit: 500, // fetch more, filter below
      offset: 0
    })

    // Filter alerts: rule ownership AND resource scope. Both gates must
    // pass — a tenant-owned rule that fires on a neighbour tenant's node
    // (orchestrator is not tenant-aware) would otherwise leak through.
    const allAlerts = response.data?.data || response.data || []
    const vdcVmids = vdcScope ? await getVdcVmidsByConnection(tenantId) : undefined
    const visibilityCtx = { tenantId, tenantConnectionIds, vdcScope, vdcVmids, infraKind: infra.kind }
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

    // Deduplicate by fingerprint: keep only the most recent entry per unique alert
    const deduped = Array.isArray(annotated)
      ? Array.from(
          annotated.reduce((map: Map<string, any>, a: any) => {
            const fp = a._fingerprint
            const existing = map.get(fp)
            if (!existing || new Date(a.last_seen_at) > new Date(existing.last_seen_at)) {
              map.set(fp, a)
            }
            return map
          }, new Map()).values()
        )
      : annotated

    // Apply post-annotation status filter (e.g. ?status=active should exclude silenced)
    const finalFiltered = Array.isArray(deduped) && status
      ? deduped.filter((a: any) => a.status === status)
      : deduped

    const sliced = Array.isArray(finalFiltered) ? finalFiltered.slice(offset, offset + limit) : finalFiltered

    return NextResponse.json({
      ...(response.data || {}),
      data: sliced,
      total: Array.isArray(finalFiltered) ? finalFiltered.length : 0,
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

    // Verify connection belongs to tenant if specified
    if (connectionId) {
      const tenantConnectionIds = await getTenantConnectionIds()
      if (!tenantConnectionIds.has(connectionId)) {
        return NextResponse.json({ error: 'Connection not found' }, { status: 404 })
      }
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
