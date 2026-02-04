import { NextResponse } from 'next/server'

import { alertsApi } from '@/lib/orchestrator/client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/v1/orchestrator/alerts/[id]/acknowledge
 * Acquitte une alerte
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const body = await req.json().catch(() => ({}))
    const acknowledgedBy = body.acknowledged_by || 'unknown'

    const response = await alertsApi.acknowledge(id, acknowledgedBy)

    
return NextResponse.json(response.data)
  } catch (error: any) {
    console.error('[orchestrator/alerts/[id]/acknowledge] POST error:', error)
    
return NextResponse.json(
      { error: error?.message || 'Failed to acknowledge alert' },
      { status: 500 }
    )
  }
}
