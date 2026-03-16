import { NextResponse } from 'next/server'

import { alertsApi } from '@/lib/orchestrator/client'
import { getTenantConnectionIds } from '@/lib/tenant'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/v1/orchestrator/alerts/[id]
 * Récupère une alerte par son ID (vérifie l'appartenance au tenant)
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const response = await alertsApi.getAlert(id)
    const alert = response.data

    // Verify alert belongs to tenant
    if (alert?.connection_id) {
      const tenantConnectionIds = await getTenantConnectionIds()
      if (!tenantConnectionIds.has(alert.connection_id)) {
        return NextResponse.json({ error: 'Alert not found' }, { status: 404 })
      }
    }

    return NextResponse.json(alert)
  } catch (error: any) {
    if ((error as any)?.code !== 'ORCHESTRATOR_UNAVAILABLE') {
      console.error('[orchestrator/alerts/[id]] GET error:', error)
    }

    return NextResponse.json(
      { error: error?.message || 'Alert not found' },
      { status: 404 }
    )
  }
}
