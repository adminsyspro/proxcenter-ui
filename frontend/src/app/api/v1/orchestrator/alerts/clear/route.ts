import { NextResponse } from 'next/server'

import { orchestratorFetch } from '@/lib/orchestrator/client'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * DELETE /api/v1/orchestrator/alerts/clear
 * Résout toutes les alertes actives
 */
export async function DELETE(req: Request) {
  try {
    const { searchParams } = new URL(req.url)
    const connectionId = searchParams.get('connection_id')
    
    const url = connectionId 
      ? `/alerts/clear?connection_id=${connectionId}`
      : '/alerts/clear'
    
    const result = await orchestratorFetch(url, { method: 'DELETE' })

    
return NextResponse.json(result)
  } catch (error: any) {
    console.error('[orchestrator/alerts/clear] DELETE error:', error)
    
return NextResponse.json(
      { error: error?.message || 'Failed to clear alerts' },
      { status: 500 }
    )
  }
}