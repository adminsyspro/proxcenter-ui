import { NextResponse } from 'next/server'

import { orchestratorFetch } from '@/lib/orchestrator/client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/v1/orchestrator/alerts/rules
 * Liste toutes les règles d'événements
 */
export async function GET() {
  try {
    const rules = await orchestratorFetch('/alerts/rules')

    
return NextResponse.json(rules)
  } catch (error: any) {
    console.error('[orchestrator/alerts/rules] GET error:', error)
    
    if (error.message?.includes('ECONNREFUSED') || error.message?.includes('timeout')) {
      return NextResponse.json([])
    }

    return NextResponse.json(
      { error: error?.message || 'Failed to fetch rules' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/v1/orchestrator/alerts/rules
 * Crée une nouvelle règle
 */
export async function POST(req: Request) {
  try {
    const body = await req.json()

    const rule = await orchestratorFetch('/alerts/rules', {
      method: 'POST',
      body
    })

    
return NextResponse.json(rule)
  } catch (error: any) {
    console.error('[orchestrator/alerts/rules] POST error:', error)
    
return NextResponse.json(
      { error: error?.message || 'Failed to create rule' },
      { status: 500 }
    )
  }
}
