import { NextResponse } from 'next/server'

import { alertsApi } from '@/lib/orchestrator/client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/v1/orchestrator/alerts/active
 * Récupère uniquement les alertes actives
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const connectionId = searchParams.get('connection_id') || undefined

    const response = await alertsApi.getActiveAlerts(connectionId)

    
return NextResponse.json(response.data)
  } catch (error: any) {
    console.error('[orchestrator/alerts/active] GET error:', error)
    
    if (error.message?.includes('ECONNREFUSED') || error.message?.includes('timeout')) {
      return NextResponse.json([])
    }

    return NextResponse.json(
      { error: error?.message || 'Failed to fetch active alerts' },
      { status: 500 }
    )
  }
}
