import { NextResponse } from 'next/server'

import { orchestratorFetch } from '@/lib/orchestrator/client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/v1/orchestrator/alerts/rules/[id]/toggle
 * Active/désactive une règle
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const result = await orchestratorFetch(`/alerts/rules/${id}/toggle`, {
      method: 'POST'
    })

    
return NextResponse.json(result)
  } catch (error: any) {
    console.error('[orchestrator/alerts/rules/[id]/toggle] POST error:', error)
    
return NextResponse.json(
      { error: error?.message || 'Failed to toggle rule' },
      { status: 500 }
    )
  }
}
