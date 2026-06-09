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
 * GET /api/v1/orchestrator/alerts/active
 * Récupère uniquement les alertes actives, filtrées par tenant ET par silences.
 * Silenced alerts are excluded entirely — the sole consumer is the Infrastructure
 * Health badge counter, which should reflect "alerts the user has not muted".
 */
export async function GET(req: Request) {
  const demo = demoResponse(req)
  if (demo) return demo

  try {
    const denied = await checkPermission(PERMISSIONS.ALERTS_VIEW)
    if (denied) return denied

    const { searchParams } = new URL(req.url)
    const connectionId = searchParams.get('connection_id') || undefined

    const tenantConnectionIds = await getTenantConnectionIds()
    const tenantId = await getCurrentTenantId()
    const infra = await getTenantInfrastructureScope(tenantId)
    const vdcScope = maskingScope(infra)
    const vdcVmids = vdcScope ? await getVdcVmidsByConnection(tenantId) : undefined
    const response = await alertsApi.getActiveAlerts(connectionId)

    const resData = response.data as any
    const alerts = Array.isArray(resData) ? resData : (resData?.data || [])
    const visibilityCtx = { tenantId, tenantConnectionIds, vdcScope, vdcVmids, infraKind: infra.kind }
    // isAlertVisibleToTenant is async (Postgres cutover made the rule
    // ownership lookup a Prisma query). Array.filter doesn't await its
    // predicate — it'd see a Promise, which is truthy, and let every
    // alert through. Resolve visibility for each alert up-front, then
    // filter on the boolean array.
    let filtered = alerts
    if (Array.isArray(alerts)) {
      const visible = await Promise.all(
        alerts.map((a: any) => isAlertVisibleToTenant(a, visibilityCtx)),
      )
      filtered = alerts.filter((_: any, i: number) => visible[i])
    }

    // Drop silenced alerts. The sibling /alerts route annotates with
    // status='silenced' so the list view can still show them; here we
    // exclude them so the badge counter respects the mute.
    if (Array.isArray(filtered) && filtered.length > 0) {
      try {
        const prisma = await getSessionPrisma()
        const now = new Date()
        const silences = await prisma.alertSilence.findMany({
          where: { OR: [{ silencedUntil: null }, { silencedUntil: { gt: now } }] },
          select: { fingerprint: true },
        })
        const silencedFingerprints = new Set(silences.map(s => s.fingerprint))
        if (silencedFingerprints.size > 0) {
          filtered = filtered.filter((a: any) => !silencedFingerprints.has(buildOrchestratorFingerprint(a)))
        }
      } catch {
        // AlertSilence table may not exist yet — fall through with un-filtered results
      }
    }

    return NextResponse.json(filtered)
  } catch (error: any) {
    if ((error as any)?.code !== 'ORCHESTRATOR_UNAVAILABLE') {
      console.error('[orchestrator/alerts/active] GET error:', error)
    }

    if (error.message?.includes('ECONNREFUSED') || error.message?.includes('timeout')) {
      return NextResponse.json([])
    }

    return NextResponse.json(
      { error: error?.message || 'Failed to fetch active alerts' },
      { status: 500 }
    )
  }
}
