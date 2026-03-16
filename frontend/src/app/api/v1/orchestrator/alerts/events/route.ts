import { NextResponse } from 'next/server'

import { orchestratorFetch } from '@/lib/orchestrator/client'
import { getTenantConnectionIds } from '@/lib/tenant'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/v1/orchestrator/alerts/events
 * Envoie des événements Proxmox à l'orchestrator pour analyse (filtrés par tenant)
 */
export async function POST(req: Request) {
  try {
    const events = await req.json()

    if (!Array.isArray(events)) {
      return NextResponse.json(
        { error: 'Events must be an array' },
        { status: 400 }
      )
    }

    // Filter events to only include those from tenant's connections
    const tenantConnectionIds = await getTenantConnectionIds()
    const filteredEvents = events.filter(
      (e: any) => !e.connectionId || tenantConnectionIds.has(e.connectionId)
    )

    const result = await orchestratorFetch('/alerts/events', {
      method: 'POST',
      body: filteredEvents
    })

    return NextResponse.json(result)
  } catch (error: any) {
    if ((error as any)?.code !== 'ORCHESTRATOR_UNAVAILABLE') {
      console.error('[orchestrator/alerts/events] POST error:', error)
    }
    
    // Si l'orchestrator n'est pas disponible, ignorer silencieusement
    if (error.message?.includes('ECONNREFUSED') || error.message?.includes('timeout')) {
      return NextResponse.json({ status: 'skipped', reason: 'orchestrator unavailable' })
    }

    return NextResponse.json(
      { error: error?.message || 'Failed to process events' },
      { status: 500 }
    )
  }
}
