import { NextResponse } from 'next/server'

import { alertsApi } from '@/lib/orchestrator/client'
import { demoResponse } from '@/lib/demo/demo-api'
import { getCurrentTenantId, getTenantConnectionIds } from '@/lib/tenant'
import { getVdcScope } from '@/lib/vdc/scope'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { isAlertVisibleToTenant } from '@/lib/alerts/visibility'
import { getVdcVmidsByConnection } from '@/lib/alerts/vdcVmids'

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
  const demo = demoResponse(req)

  if (demo) return demo

  try {
    const denied = await checkPermission(PERMISSIONS.ALERTS_MANAGE)

    if (denied) return denied

    const { id } = await params
    const body = await req.json().catch(() => ({}))
    const acknowledgedBy = body.acknowledged_by || 'unknown'

    // Full tenant scope check (connection + node + pool).
    const alertRes = await alertsApi.getAlert(id)
    const tenantId = await getCurrentTenantId()
    const tenantConnectionIds = await getTenantConnectionIds()
    const vdcScope = await getVdcScope(tenantId)
    const vdcVmids = vdcScope ? await getVdcVmidsByConnection(tenantId) : undefined

    if (!(await isAlertVisibleToTenant(alertRes.data as any, { tenantId, tenantConnectionIds, vdcScope, vdcVmids }))) {
      return NextResponse.json({ error: 'Alert not found' }, { status: 404 })
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
