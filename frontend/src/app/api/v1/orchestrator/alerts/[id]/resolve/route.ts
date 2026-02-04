import { NextResponse } from 'next/server'

import { alertsApi } from '@/lib/orchestrator/client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/v1/orchestrator/alerts/[id]/resolve
 * Résout manuellement une alerte
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const response = await alertsApi.resolve(id)

    
return NextResponse.json(response.data)
  } catch (error: any) {
    console.error('[orchestrator/alerts/[id]/resolve] POST error:', error)
    
return NextResponse.json(
      { error: error?.message || 'Failed to resolve alert' },
      { status: 500 }
    )
  }
}
