import { NextResponse } from 'next/server'

import { alertsApi } from '@/lib/orchestrator/client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/v1/orchestrator/alerts/summary
 * Récupère le résumé des alertes
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const connectionId = searchParams.get('connection_id') || undefined

    const response = await alertsApi.getSummary(connectionId)

    
return NextResponse.json(response.data)
  } catch (error: any) {
    console.error('[orchestrator/alerts/summary] GET error:', error)
    
    // Valeurs par défaut si orchestrator indisponible
    if (error.message?.includes('ECONNREFUSED') || error.message?.includes('timeout')) {
      return NextResponse.json({
        total_active: 0,
        critical: 0,
        warning: 0,
        info: 0,
        acknowledged: 0,
        resolved_today: 0
      })
    }

    return NextResponse.json(
      { error: error?.message || 'Failed to fetch summary' },
      { status: 500 }
    )
  }
}
