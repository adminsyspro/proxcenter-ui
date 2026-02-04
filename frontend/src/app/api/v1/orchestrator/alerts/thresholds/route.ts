import { NextResponse } from 'next/server'

import { alertsApi } from '@/lib/orchestrator/client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/v1/orchestrator/alerts/thresholds
 * Récupère les seuils d'alertes configurés
 */
export async function GET() {
  try {
    const response = await alertsApi.getThresholds()

    
return NextResponse.json(response.data)
  } catch (error: any) {
    console.error('[orchestrator/alerts/thresholds] GET error:', error)
    
    // Valeurs par défaut si orchestrator indisponible
    if (error.message?.includes('ECONNREFUSED') || error.message?.includes('timeout')) {
      return NextResponse.json({
        cpu_warning: 80,
        cpu_critical: 95,
        memory_warning: 85,
        memory_critical: 95,
        storage_warning: 80,
        storage_critical: 90
      })
    }

    return NextResponse.json(
      { error: error?.message || 'Failed to fetch thresholds' },
      { status: 500 }
    )
  }
}

/**
 * PUT /api/v1/orchestrator/alerts/thresholds
 * Met à jour les seuils d'alertes
 */
export async function PUT(req: Request) {
  try {
    const body = await req.json()
    const response = await alertsApi.updateThresholds(body)

    
return NextResponse.json(response.data)
  } catch (error: any) {
    console.error('[orchestrator/alerts/thresholds] PUT error:', error)
    
return NextResponse.json(
      { error: error?.message || 'Failed to update thresholds' },
      { status: 500 }
    )
  }
}
