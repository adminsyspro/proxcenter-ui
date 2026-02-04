import { NextRequest, NextResponse } from 'next/server'

import { orchestratorFetch } from '@/lib/orchestrator'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const limit = searchParams.get('limit') || '20'
    const offset = searchParams.get('offset') || '0'
    
    const data = await orchestratorFetch(`/notifications/history?limit=${limit}&offset=${offset}`)

    
return NextResponse.json(data)
  } catch (error: any) {
    console.error('Failed to get notification history:', error)
    
return NextResponse.json(
      { error: error.message || 'Failed to get notification history' },
      { status: 500 }
    )
  }
}
