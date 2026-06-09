import { NextResponse } from 'next/server'

import { alertsApi } from '@/lib/orchestrator/client'
import { demoResponse } from '@/lib/demo/demo-api'
import { getCurrentTenantId, getTenantConnectionIds } from '@/lib/tenant'
import { getTenantInfrastructureScope, maskingScope } from '@/lib/tenant/infraScope'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { isAlertVisibleToTenant } from '@/lib/alerts/visibility'
import { getVdcVmidsByConnection } from '@/lib/alerts/vdcVmids'

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
  const demo = demoResponse(req)
  if (demo) return demo

  try {
    const denied = await checkPermission(PERMISSIONS.ALERTS_VIEW)
    if (denied) return denied

    const { id } = await params
    const response = await alertsApi.getAlert(id)
    const alert = response.data

    // Full tenant scope check (connection + node + pool). Same gate as
    // the list endpoint so an opportunistic ID lookup can't bypass vDC
    // isolation on shared clusters.
    const tenantId = await getCurrentTenantId()
    const tenantConnectionIds = await getTenantConnectionIds()
    const infra = await getTenantInfrastructureScope(tenantId)
    const vdcScope = maskingScope(infra)
    const vdcVmids = vdcScope ? await getVdcVmidsByConnection(tenantId) : undefined
    if (!(await isAlertVisibleToTenant(alert as any, { tenantId, tenantConnectionIds, vdcScope, vdcVmids, infraKind: infra.kind }))) {
      return NextResponse.json({ error: 'Alert not found' }, { status: 404 })
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

/**
 * DELETE /api/v1/orchestrator/alerts/[id]
 * Supprime une alerte par son ID
 */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const demo = demoResponse(req)
  if (demo) return demo

  try {
    const denied = await checkPermission(PERMISSIONS.ALERTS_MANAGE)
    if (denied) return denied

    const { id } = await params

    // Full tenant scope check before deletion.
    const alertRes = await alertsApi.getAlert(id)
    const tenantId = await getCurrentTenantId()
    const tenantConnectionIds = await getTenantConnectionIds()
    const infra = await getTenantInfrastructureScope(tenantId)
    const vdcScope = maskingScope(infra)
    const vdcVmids = vdcScope ? await getVdcVmidsByConnection(tenantId) : undefined
    if (!(await isAlertVisibleToTenant(alertRes.data as any, { tenantId, tenantConnectionIds, vdcScope, vdcVmids, infraKind: infra.kind }))) {
      return NextResponse.json({ error: 'Alert not found' }, { status: 404 })
    }

    const response = await alertsApi.deleteAlert(id)

    return NextResponse.json(response.data)
  } catch (error: any) {
    if ((error as any)?.code !== 'ORCHESTRATOR_UNAVAILABLE') {
      console.error('[orchestrator/alerts/[id]] DELETE error:', error)
    }

    return NextResponse.json(
      { error: error?.message || 'Failed to delete alert' },
      { status: 500 }
    )
  }
}
