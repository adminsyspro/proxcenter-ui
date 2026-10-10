export const dynamic = "force-dynamic"
import { NextRequest, NextResponse } from 'next/server'

import { orchestratorFetch } from '@/lib/orchestrator'
import { relayOrchestratorError } from '@/lib/orchestrator/relayError'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { requireProviderTenant } from '@/lib/tenant'

// Notification channels (Slack, Teams, ntfy, Discord, generic webhook) live
// in the orchestrator next to the email settings; these routes only relay.
// Secrets go one way: the orchestrator answers with a masked URL and flags.

export async function GET() {
  // Channels are global (orchestrator not tenant-aware): admins only, like the settings.
  const denied = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)
  if (denied) return denied
  // Notifications are global and the tab is provider-only: a tenant admin
  // holds admin.settings too, and must not read the recipients or add a
  // channel that receives every tenant's alerts.
  const providerGate = await requireProviderTenant()
  if (providerGate) return providerGate

  try {
    const data = await orchestratorFetch('/notifications/channels')

    return NextResponse.json(data)
  } catch (error) {
    return relayOrchestratorError(error, 'Failed to list notification channels')
  }
}

export async function POST(request: NextRequest) {
  const denied = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)
  if (denied) return denied
  const providerGate = await requireProviderTenant()
  if (providerGate) return providerGate

  try {
    const body = await request.json()

    const data = await orchestratorFetch('/notifications/channels', {
      method: 'POST',
      body
    })

    return NextResponse.json(data, { status: 201 })
  } catch (error) {
    return relayOrchestratorError(error, 'Failed to create notification channel')
  }
}
