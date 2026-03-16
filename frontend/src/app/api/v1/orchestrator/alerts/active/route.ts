import { NextResponse } from 'next/server'

import { alertsApi } from '@/lib/orchestrator/client'
import { getTenantConnectionIds } from '@/lib/tenant'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/v1/orchestrator/alerts/active
 * Récupère uniquement les alertes actives, filtrées par tenant
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const connectionId = searchParams.get('connection_id') || undefined

    const tenantConnectionIds = await getTenantConnectionIds()
    const response = await alertsApi.getActiveAlerts(connectionId)

    const resData = response.data as any
    const alerts = Array.isArray(resData) ? resData : (resData?.data || [])
    const filtered = Array.isArray(alerts)
      ? alerts.filter((a: any) => !a.connection_id || tenantConnectionIds.has(a.connection_id))
      : alerts

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
