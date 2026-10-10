import { NextResponse } from 'next/server'

import { demoResponse } from '@/lib/demo/demo-api'
import { getCurrentTenantId, getSessionPrisma, getTenantConnectionIds } from '@/lib/tenant'
import { getTenantInfrastructureScope, maskingScope } from '@/lib/tenant/infraScope'
import { checkPermission, PERMISSIONS, getCurrentRbacInfraScope } from '@/lib/rbac'
import { isAlertVisibleToTenant } from '@/lib/alerts/visibility'
import { getVdcVmidsByConnection } from '@/lib/alerts/vdcVmids'
import { buildOrchestratorFingerprint } from '@/lib/alerts/orchestratorFingerprint'
import { dedupeOrchestratorAlerts, fetchOrchestratorAlerts } from '@/lib/alerts/orchestratorAlertFeed'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/v1/orchestrator/alerts/summary
 * Récupère le résumé des alertes, recomputed from tenant-filtered alerts
 */
export async function GET(req: Request) {
  const demo = demoResponse(req)
  if (demo) return demo

  try {
    // Same baseline as the alerts list endpoint — vDC tenants need the
    // summary cards even without alerts.view in their default role.
    const denied = await checkPermission(PERMISSIONS.CONNECTION_VIEW)
    if (denied) return denied

    const tenantConnectionIds = await getTenantConnectionIds()
    const tenantId = await getCurrentTenantId()
    const infra = await getTenantInfrastructureScope(tenantId)
    const vdcScope = maskingScope(infra)

    // Recompute the summary from tenant-filtered data, with the same feed as
    // the alerts list: every open alert, however old, plus recent resolved
    // history. A window of the newest 1000 rows missed old open ones (#1086).
    const allAlerts = await fetchOrchestratorAlerts()
    const vdcVmids = vdcScope ? await getVdcVmidsByConnection(tenantId) : undefined
    // Caller's RBAC infra scope (issue #525), honoured inside isAlertVisibleToTenant.
    const rbacScope = await getCurrentRbacInfraScope(PERMISSIONS.CONNECTION_VIEW)
    const visibilityCtx = { tenantId, tenantConnectionIds, vdcScope, vdcVmids, infraKind: infra.kind, rbacScope }
    // isAlertVisibleToTenant became async in the Postgres cutover; resolve
    // each alert's visibility up-front before filtering, otherwise the
    // filter sees a Promise (truthy) and lets every alert through.
    let filtered: any[] = []
    if (Array.isArray(allAlerts)) {
      const visible = await Promise.all(
        allAlerts.map((a: any) => isAlertVisibleToTenant(a, visibilityCtx)),
      )
      filtered = allAlerts.filter((_: any, i: number) => visible[i])
    }

    // Exclude silenced alerts from counts
    let silencedFingerprints = new Set<string>()

    try {
      const prisma = await getSessionPrisma()
      const now = new Date()
      const silences = await prisma.alertSilence.findMany({
        where: {
          OR: [
            { silencedUntil: null },
            { silencedUntil: { gt: now } },
          ],
        },
        select: { fingerprint: true, reason: true },
      })
      // Both muted and dismissed alerts are excluded from counts
      silencedFingerprints = new Set(silences.map(s => s.fingerprint))
    } catch {
      // Table may not exist yet
    }

    // Deduplicate before counting, by fingerprint and status like the list
    const deduped = dedupeOrchestratorAlerts(
      filtered.map((a: any) => ({ ...a, _fp: buildOrchestratorFingerprint(a) })),
      (a: any) => a._fp,
      (a: any) => a.status,
    )

    const visible = deduped.filter((a: any) => !silencedFingerprints.has(a._fp))
    const active = visible.filter((a: any) => a.status === 'active')
    const today = new Date().toISOString().slice(0, 10)

    const summary = {
      total_active: active.length,
      critical: active.filter((a: any) => a.severity === 'critical').length,
      warning: active.filter((a: any) => a.severity === 'warning').length,
      info: active.filter((a: any) => a.severity === 'info').length,
      acknowledged: visible.filter((a: any) => a.status === 'acknowledged').length,
      resolved_today: visible.filter((a: any) => a.status === 'resolved' && a.resolved_at?.startsWith(today)).length,
    }

    return NextResponse.json(summary)
  } catch (error: any) {
    if ((error as any)?.code !== 'ORCHESTRATOR_UNAVAILABLE') {
      console.error('[orchestrator/alerts/summary] GET error:', error)
    }

    if (error.message?.includes('ECONNREFUSED') || error.message?.includes('timeout')) {
      return NextResponse.json({
        total_active: 0,
        critical: 0,
        warning: 0,
        info: 0,
        acknowledged: 0,
        resolved_today: 0
      })
    }

    return NextResponse.json(
      { error: error?.message || 'Failed to fetch summary' },
      { status: 500 }
    )
  }
}
