import { NextResponse } from 'next/server'

import { orchestrator, PulseHealth } from '@/lib/orchestrator/client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/v1/orchestrator/health
 * Récupère l'état de santé de Pulse (orchestrateur)
 */
export async function GET() {
  try {
    const response = await orchestrator.health()

    
return NextResponse.json(response.data)
  } catch (error: any) {
    console.error('[orchestrator/health] GET error:', error)
    
    // Si l'orchestrator est indisponible, retourner un statut offline
    if (error.message?.includes('ECONNREFUSED') || error.message?.includes('timeout') || error.message?.includes('fetch failed')) {
      const offlineResponse: PulseHealth = {
        status: 'error',
        time: new Date().toISOString(),
        version: 'unknown',
        components: {
          drs: {
            enabled: false,
            mode: 'unknown',
            active_migrations: 0
          },
          connections: {
            total: 0,
            connected: 0,
            details: []
          }
        }
      }

      
return NextResponse.json(offlineResponse)
    }

    return NextResponse.json(
      { 
        status: 'error',
        error: error?.message || 'Failed to fetch health status'
      },
      { status: 500 }
    )
  }
}
