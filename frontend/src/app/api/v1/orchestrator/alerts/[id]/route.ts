import { NextResponse } from 'next/server'

import { alertsApi } from '@/lib/orchestrator/client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/v1/orchestrator/alerts/[id]
 * Récupère une alerte par son ID
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params
    const response = await alertsApi.getAlert(id)

    
return NextResponse.json(response.data)
  } catch (error: any) {
    console.error('[orchestrator/alerts/[id]] GET error:', error)
    
return NextResponse.json(
      { error: error?.message || 'Alert not found' },
      { status: 404 }
    )
  }
}
