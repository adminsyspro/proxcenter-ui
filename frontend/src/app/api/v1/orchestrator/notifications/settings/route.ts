export const dynamic = "force-dynamic"
import { NextRequest, NextResponse } from 'next/server'

import { orchestratorFetch } from '@/lib/orchestrator'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { requireProviderTenant } from '@/lib/tenant'

export async function GET() {
  // Notification settings are global (orchestrator not tenant-aware) — restrict to admins
  const denied = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)
  if (denied) return denied
  // Notifications are global and the tab is provider-only: a tenant admin
  // holds admin.settings too, and must not read the recipients or add a
  // channel that receives every tenant's alerts.
  const providerGate = await requireProviderTenant()
  if (providerGate) return providerGate

  try {
    const data = await orchestratorFetch('/notifications/settings')


return NextResponse.json(data)
  } catch (error: any) {
    if ((error as any)?.code !== 'ORCHESTRATOR_UNAVAILABLE') {
      console.error('Failed to get notification settings:', error)
    }

return NextResponse.json(
      { error: error.message || 'Failed to get notification settings' },
      { status: 500 }
    )
  }
}

export async function PUT(request: NextRequest) {
  // Notification settings are global (orchestrator not tenant-aware) — restrict to admins
  const denied = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)
  if (denied) return denied
  const providerGate = await requireProviderTenant()
  if (providerGate) return providerGate

  try {
    const body = await request.json()

    const data = await orchestratorFetch('/notifications/settings', {
      method: 'PUT',
      body
    })


return NextResponse.json(data)
  } catch (error: any) {
    if ((error as any)?.code !== 'ORCHESTRATOR_UNAVAILABLE') {
      console.error('Failed to update notification settings:', error)
    }

return NextResponse.json(
      { error: error.message || 'Failed to update notification settings' },
      { status: 500 }
    )
  }
}
