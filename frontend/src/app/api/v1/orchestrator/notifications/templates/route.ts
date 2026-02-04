import { NextResponse } from 'next/server'

import { orchestratorFetch } from '@/lib/orchestrator'

/**
 * GET /api/v1/orchestrator/notifications/templates
 * Récupère tous les templates email
 */
export async function GET() {
  try {
    const result = await orchestratorFetch('/notifications/templates')

    return NextResponse.json(result)
  } catch (error: any) {
    console.error('[orchestrator/notifications/templates] GET error:', error)

    return NextResponse.json(
      { error: error.message || 'Failed to get templates' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/v1/orchestrator/notifications/templates
 * Sauvegarde un template email
 */
export async function POST(request: Request) {
  try {
    const body = await request.json()

    const result = await orchestratorFetch('/notifications/templates', {
      method: 'POST',
      body
    })

    return NextResponse.json(result)
  } catch (error: any) {
    console.error('[orchestrator/notifications/templates] POST error:', error)

    return NextResponse.json(
      { error: error.message || 'Failed to save template' },
      { status: 500 }
    )
  }
}
