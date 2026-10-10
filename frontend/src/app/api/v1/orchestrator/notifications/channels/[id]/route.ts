export const dynamic = "force-dynamic"
import { NextRequest, NextResponse } from 'next/server'

import { orchestratorFetch } from '@/lib/orchestrator'
import { relayOrchestratorError } from '@/lib/orchestrator/relayError'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { requireProviderTenant } from '@/lib/tenant'

type Params = { params: Promise<{ id: string }> | { id: string } }

export async function PUT(request: NextRequest, { params }: Params) {
  const denied = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)
  if (denied) return denied
  // Notifications are global and the tab is provider-only: a tenant admin
  // holds admin.settings too, and must not read the recipients or add a
  // channel that receives every tenant's alerts.
  const providerGate = await requireProviderTenant()
  if (providerGate) return providerGate

  const { id } = await params

  try {
    const body = await request.json()

    const data = await orchestratorFetch(`/notifications/channels/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body
    })

    return NextResponse.json(data)
  } catch (error) {
    return relayOrchestratorError(error, 'Failed to update notification channel')
  }
}

export async function DELETE(_request: NextRequest, { params }: Params) {
  const denied = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)
  if (denied) return denied
  const providerGate = await requireProviderTenant()
  if (providerGate) return providerGate

  const { id } = await params

  try {
    const data = await orchestratorFetch(`/notifications/channels/${encodeURIComponent(id)}`, {
      method: 'DELETE'
    })

    return NextResponse.json(data)
  } catch (error) {
    return relayOrchestratorError(error, 'Failed to delete notification channel')
  }
}
