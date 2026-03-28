export const dynamic = "force-dynamic"
import { NextRequest, NextResponse } from 'next/server'

import { orchestratorFetch } from '@/lib/orchestrator'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'

export async function POST(request: NextRequest) {
  try {
    const denied = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)
    if (denied) return denied

    const body = await request.json()

    const data = await orchestratorFetch('/notifications/test', {
      method: 'POST',
      body
    })

    
return NextResponse.json(data)
  } catch (error: any) {
    if ((error as any)?.code !== 'ORCHESTRATOR_UNAVAILABLE') {
      console.error('Failed to send test notification:', error)
    }
    
return NextResponse.json(
      { error: error.message || 'Failed to send test notification' },
      { status: 500 }
    )
  }
}
