import { NextResponse } from 'next/server'

import { alertsApi } from '@/lib/orchestrator/client'
import { getTenantConnectionIds } from '@/lib/tenant'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/v1/orchestrator/alerts/[id]/acknowledge
 * Acquitte une alerte (vérifie l'appartenance au tenant)
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    const acknowledgedBy = body.acknowledged_by || 'unknown'

    // Verify alert belongs to tenant
    const alertRes = await alertsApi.getAlert(id)
    if (alertRes.data?.connection_id) {
      const tenantConnectionIds = await getTenantConnectionIds()
      if (!tenantConnectionIds.has(alertRes.data.connection_id)) {
        return NextResponse.json({ error: 'Alert not found' }, { status: 404 })
      }
    }

    const response = await alertsApi.acknowledge(id, acknowledgedBy)

    return NextResponse.json(response.data)
  } catch (error: any) {
    if ((error as any)?.code !== 'ORCHESTRATOR_UNAVAILABLE') {
      console.error('[orchestrator/alerts/[id]/acknowledge] POST error:', error)
    }

    return NextResponse.json(
      { error: error?.message || 'Failed to acknowledge alert' },
      { status: 500 }
    )
  }
}
