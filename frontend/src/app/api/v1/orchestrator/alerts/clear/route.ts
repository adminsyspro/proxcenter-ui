import { NextResponse } from 'next/server'

import { alertsApi } from '@/lib/orchestrator/client'
import { demoResponse } from '@/lib/demo/demo-api'
import { DEFAULT_TENANT_ID, getCurrentTenantId, getTenantConnectionIds } from '@/lib/tenant'
import { checkPermission, getCurrentRbacInfraScope, PERMISSIONS } from '@/lib/rbac'
import { clearVisibleTenantAlerts } from '@/lib/alerts/clearVisible'
import { withAudit } from '@/lib/audit/withAudit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * DELETE /api/v1/orchestrator/alerts/clear
 * Résout toutes les alertes actives (scoped to tenant connections)
 */
async function handleDelete(req: Request) {
  const demo = demoResponse(req)
  if (demo) return demo

  try {
    const denied = await checkPermission(PERMISSIONS.ALERTS_MANAGE)
    if (denied) return denied

    const { searchParams } = new URL(req.url)
    const connectionId = searchParams.get('connection_id')

    // Verify connection belongs to tenant if specified
    const tenantConnectionIds = await getTenantConnectionIds()
    if (connectionId && !tenantConnectionIds.has(connectionId)) {
      return NextResponse.json({ error: 'Connection not found' }, { status: 404 })
    }

    // Non-provider: the orchestrator's clear is connection-wide and has no
    // tenant concept — on a shared cluster it would wipe the neighbours'
    // alerts too. Clear only the alerts this caller can actually see
    // (vDC-context view, mirrors the GET list), one by one. A provider caller
    // whose alerts.manage is scoped to a node or a VM resolves the alerts it
    // sees, one by one (roadmap#223).
    const tenantId = await getCurrentTenantId()
    if (tenantId !== DEFAULT_TENANT_ID) {
      const cleared = await clearVisibleTenantAlerts(connectionId || undefined)

      return NextResponse.json({ cleared })
    }
    if ((await getCurrentRbacInfraScope(PERMISSIONS.ALERTS_MANAGE)) !== null) {
      const cleared = await clearVisibleTenantAlerts(connectionId || undefined, 'resolve')

      return NextResponse.json({ cleared })
    }

    // Provider: the orchestrator resolves the active alerts of a connection
    // (DELETE /alerts?connection_id=). It has no /alerts/clear route: that
    // path deleted an alert whose id is "clear" and left every alert open.
    if (!connectionId) {
      for (const connId of tenantConnectionIds) {
        await alertsApi.clearAll(connId)
      }
      return NextResponse.json({ cleared: tenantConnectionIds.size })
    }

    const result = await alertsApi.clearAll(connectionId)

    return NextResponse.json(result.data)
  } catch (error: any) {
    if ((error as any)?.code !== 'ORCHESTRATOR_UNAVAILABLE') {
      console.error('[orchestrator/alerts/clear] DELETE error:', error)
    }
    
return NextResponse.json(
      { error: error?.message || 'Failed to clear alerts' },
      { status: 500 }
    )
  }
}

export const DELETE = withAudit({ category: 'alerts', resourceType: 'clear' }, handleDelete)
