import { NextResponse } from 'next/server'

import { alertsApi } from '@/lib/orchestrator/client'
import { getSessionPrisma, getTenantConnectionIds } from '@/lib/tenant'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/v1/orchestrator/alerts
 * Récupère les alertes depuis l'orchestrator, filtrées par tenant
 */
export async function GET(req: Request) {
  try {
    const denied = await checkPermission(PERMISSIONS.ALERTS_VIEW)
    if (denied) return denied

    const { searchParams } = new URL(req.url)
    const connectionId = searchParams.get('connection_id') || undefined
    const status = searchParams.get('status') as 'active' | 'acknowledged' | 'resolved' | undefined
    const limit = searchParams.get('limit') ? Number.parseInt(searchParams.get('limit')!) : 100
    const offset = searchParams.get('offset') ? Number.parseInt(searchParams.get('offset')!) : 0

    // Get tenant's connection IDs for filtering
    const prisma = await getSessionPrisma()
    const tenantConnections = await prisma.connection.findMany({ select: { id: true } })
    const tenantConnectionIds = new Set(tenantConnections.map((c: any) => c.id))

    const response = await alertsApi.getAlerts({
      connection_id: connectionId,
      status: status || undefined,
      limit: 500, // fetch more, filter below
      offset: 0
    })

    // Filter alerts to only include those from tenant's connections
    const allAlerts = response.data?.data || response.data || []
    const filtered = Array.isArray(allAlerts)
      ? allAlerts.filter((a: any) => !a.connection_id || tenantConnectionIds.has(a.connection_id))
      : allAlerts

    const sliced = Array.isArray(filtered) ? filtered.slice(offset, offset + limit) : filtered

    return NextResponse.json({
      ...(response.data || {}),
      data: sliced,
      total: Array.isArray(filtered) ? filtered.length : 0,
    })
  } catch (error: any) {
    if ((error as any)?.code !== 'ORCHESTRATOR_UNAVAILABLE') {
      console.error('[orchestrator/alerts] GET error:', error)
    }
    
    // Si l'orchestrator n'est pas disponible, retourner une liste vide
    if (error.message?.includes('ECONNREFUSED') || error.message?.includes('timeout')) {
      return NextResponse.json({
        data: [],
        total: 0,
        limit: 100,
        offset: 0,
        error: 'Orchestrator unavailable'
      })
    }

    return NextResponse.json(
      { error: error?.message || 'Failed to fetch alerts' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/v1/orchestrator/alerts
 * Efface toutes les alertes actives (scoped to tenant connections)
 */
export async function DELETE(req: Request) {
  try {
    const denied = await checkPermission(PERMISSIONS.ALERTS_MANAGE)
    if (denied) return denied

    const { searchParams } = new URL(req.url)
    const connectionId = searchParams.get('connection_id') || undefined

    // Verify connection belongs to tenant if specified
    if (connectionId) {
      const tenantConnectionIds = await getTenantConnectionIds()
      if (!tenantConnectionIds.has(connectionId)) {
        return NextResponse.json({ error: 'Connection not found' }, { status: 404 })
      }
    }

    const response = await alertsApi.clearAll(connectionId)

    return NextResponse.json(response.data)
  } catch (error: any) {
    if ((error as any)?.code !== 'ORCHESTRATOR_UNAVAILABLE') {
      console.error('[orchestrator/alerts] DELETE error:', error)
    }

    return NextResponse.json(
      { error: error?.message || 'Failed to clear alerts' },
      { status: 500 }
    )
  }
}
