import { NextResponse } from 'next/server'

import { orchestratorFetch } from '@/lib/orchestrator/client'
import { demoResponse } from '@/lib/demo/demo-api'
import { scopeRelayedEvents } from '@/lib/alerts/eventRelayScope'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/v1/orchestrator/alerts/events
 * Envoie des événements Proxmox à l'orchestrator pour analyse. Le corps vient
 * du navigateur (la page Événements relaie son flux) : seuls passent les
 * événements que l'appelant pourrait lire sur GET /api/v1/events
 * (lib/alerts/eventRelayScope), les autres sont retirés.
 */
export async function POST(req: Request) {
  const demo = demoResponse(req)
  if (demo) return demo

  try {
    const denied = await checkPermission(PERMISSIONS.ALERTS_MANAGE)
    if (denied) return denied

    const events = await req.json()

    if (!Array.isArray(events)) {
      return NextResponse.json(
        { error: 'Events must be an array' },
        { status: 400 }
      )
    }

    const filteredEvents = await scopeRelayedEvents(events)
    if (filteredEvents.length === 0) {
      return NextResponse.json({ status: 'ok', processed: 0 })
    }

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
