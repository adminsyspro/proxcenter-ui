import { NextResponse } from 'next/server'

import { orchestratorFetch } from '@/lib/orchestrator'

export async function POST() {
  try {
    const data = await orchestratorFetch('/notifications/test-connection', {
      method: 'POST'
    })

    
return NextResponse.json(data)
  } catch (error: any) {
    console.error('Failed to test SMTP connection:', error)
    
return NextResponse.json(
      { success: false, error: error.message || 'Failed to test SMTP connection' },
      { status: 200 }
    )
  }
}
