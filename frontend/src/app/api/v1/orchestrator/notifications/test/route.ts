import { NextRequest, NextResponse } from 'next/server'

import { orchestratorFetch } from '@/lib/orchestrator'

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()

    const data = await orchestratorFetch('/notifications/test', {
      method: 'POST',
      body
    })

    
return NextResponse.json(data)
  } catch (error: any) {
    console.error('Failed to send test notification:', error)
    
return NextResponse.json(
      { error: error.message || 'Failed to send test notification' },
      { status: 500 }
    )
  }
}
