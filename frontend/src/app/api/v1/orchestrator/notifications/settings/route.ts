import { NextRequest, NextResponse } from 'next/server'

import { orchestratorFetch } from '@/lib/orchestrator'

export async function GET() {
  try {
    const data = await orchestratorFetch('/notifications/settings')

    
return NextResponse.json(data)
  } catch (error: any) {
    console.error('Failed to get notification settings:', error)
    
return NextResponse.json(
      { error: error.message || 'Failed to get notification settings' },
      { status: 500 }
    )
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json()

    const data = await orchestratorFetch('/notifications/settings', {
      method: 'PUT',
      body
    })

    
return NextResponse.json(data)
  } catch (error: any) {
    console.error('Failed to update notification settings:', error)
    
return NextResponse.json(
      { error: error.message || 'Failed to update notification settings' },
      { status: 500 }
    )
  }
}
