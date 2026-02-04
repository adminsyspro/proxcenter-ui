import { NextResponse } from 'next/server'

import { alertsApi } from '@/lib/orchestrator/client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/v1/orchestrator/alerts
 * Récupère les alertes depuis l'orchestrator
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const connectionId = searchParams.get('connection_id') || undefined
    const status = searchParams.get('status') as 'active' | 'acknowledged' | 'resolved' | undefined
    const limit = searchParams.get('limit') ? parseInt(searchParams.get('limit')!) : 100
    const offset = searchParams.get('offset') ? parseInt(searchParams.get('offset')!) : 0

    const response = await alertsApi.getAlerts({
      connection_id: connectionId,
      status: status || undefined,
      limit,
      offset
    })

    return NextResponse.json(response.data)
  } catch (error: any) {
    console.error('[orchestrator/alerts] GET error:', error)
    
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
 * Efface toutes les alertes actives
 */
export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const connectionId = searchParams.get('connection_id') || undefined

    const response = await alertsApi.clearAll(connectionId)

    
return NextResponse.json(response.data)
  } catch (error: any) {
    console.error('[orchestrator/alerts] DELETE error:', error)
    
return NextResponse.json(
      { error: error?.message || 'Failed to clear alerts' },
      { status: 500 }
    )
  }
}
