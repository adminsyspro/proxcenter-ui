import { NextResponse } from 'next/server'

import { alertsApi } from '@/lib/orchestrator/client'
import { demoResponse } from '@/lib/demo/demo-api'
import { getTenantConnectionIds } from '@/lib/tenant'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'

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
    const denied = await checkPermission(PERMISSIONS.ALERTS_VIEW)
    if (denied) return denied

    const tenantConnectionIds = await getTenantConnectionIds()

    // Fetch all alerts to recompute summary from tenant-filtered data
    const response = await alertsApi.getAlerts({ limit: 1000, offset: 0 })
    const allAlerts = response.data?.data || response.data || []
    const filtered = Array.isArray(allAlerts)
      ? allAlerts.filter((a: any) => !a.connection_id || tenantConnectionIds.has(a.connection_id))
      : []

    const active = filtered.filter((a: any) => a.status === 'active')
    const today = new Date().toISOString().slice(0, 10)

    const summary = {
      total_active: active.length,
      critical: active.filter((a: any) => a.severity === 'critical').length,
      warning: active.filter((a: any) => a.severity === 'warning').length,
      info: active.filter((a: any) => a.severity === 'info').length,
      acknowledged: filtered.filter((a: any) => a.status === 'acknowledged').length,
      resolved_today: filtered.filter((a: any) => a.status === 'resolved' && a.resolved_at?.startsWith(today)).length,
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
