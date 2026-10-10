export const dynamic = "force-dynamic"
import { NextRequest, NextResponse } from 'next/server'

import { orchestratorFetch } from '@/lib/orchestrator'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { requireProviderTenant } from '@/lib/tenant'

export async function POST(request: NextRequest) {
  try {
    const denied = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)
    if (denied) return denied
    // Notifications are global and the tab is provider-only: a tenant admin
    // holds admin.settings too, and must not read the recipients or add a
    // channel that receives every tenant's alerts.
    const providerGate = await requireProviderTenant()
    if (providerGate) return providerGate

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
