import { NextResponse } from 'next/server'

import { orchestratorFetch } from '@/lib/orchestrator/client'
import { demoResponse } from '@/lib/demo/demo-api'
import { getTenantConnectionIds } from '@/lib/tenant'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * DELETE /api/v1/orchestrator/alerts/clear
 * Résout toutes les alertes actives (scoped to tenant connections)
 */
export async function DELETE(req: Request) {
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

    // If no specific connection, clear for each tenant connection individually
    if (!connectionId) {
      const results = []
      for (const connId of tenantConnectionIds) {
        const result = await orchestratorFetch(`/alerts/clear?connection_id=${connId}`, { method: 'DELETE' })
        results.push(result)
      }
      return NextResponse.json({ cleared: results.length })
    }

    const result = await orchestratorFetch(`/alerts/clear?connection_id=${connectionId}`, { method: 'DELETE' })

    return NextResponse.json(result)
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