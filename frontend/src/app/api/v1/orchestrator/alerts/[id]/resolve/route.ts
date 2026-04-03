import { NextResponse } from 'next/server'

import { alertsApi } from '@/lib/orchestrator/client'
import { demoResponse } from '@/lib/demo/demo-api'
import { getTenantConnectionIds } from '@/lib/tenant'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/v1/orchestrator/alerts/[id]/resolve
 * Résout manuellement une alerte (vérifie l'appartenance au tenant)
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const demo = demoResponse(req)
  if (demo) return demo

  try {
    const denied = await checkPermission(PERMISSIONS.ALERTS_MANAGE)
    if (denied) return denied

    const { id } = await params

    // Verify alert belongs to tenant
    const alertRes = await alertsApi.getAlert(id)
    if (alertRes.data?.connection_id) {
      const tenantConnectionIds = await getTenantConnectionIds()
      if (!tenantConnectionIds.has(alertRes.data.connection_id)) {
        return NextResponse.json({ error: 'Alert not found' }, { status: 404 })
      }
    }

    const response = await alertsApi.resolve(id)

    return NextResponse.json(response.data)
  } catch (error: any) {
    if ((error as any)?.code !== 'ORCHESTRATOR_UNAVAILABLE') {
      console.error('[orchestrator/alerts/[id]/resolve] POST error:', error)
    }

    return NextResponse.json(
      { error: error?.message || 'Failed to resolve alert' },
      { status: 500 }
    )
  }
}
