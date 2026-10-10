export const dynamic = "force-dynamic"
import { NextRequest, NextResponse } from 'next/server'

import { orchestratorFetch } from '@/lib/orchestrator'
import { relayOrchestratorError } from '@/lib/orchestrator/relayError'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { requireProviderTenant } from '@/lib/tenant'

// The orchestrator answers 200 with { success, error } so the exact reason
// (the receiver's HTTP status and body, or the private-network refusal)
// reaches the dialog; only a malformed body comes back as 400.
export async function POST(request: NextRequest) {
  const denied = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)
  if (denied) return denied
  // Notifications are global and the tab is provider-only: a tenant admin
  // holds admin.settings too, and must not read the recipients or add a
  // channel that receives every tenant's alerts.
  const providerGate = await requireProviderTenant()
  if (providerGate) return providerGate

  try {
    const body = await request.json()

    const data = await orchestratorFetch('/notifications/channels/test', {
      method: 'POST',
      body
    })

    return NextResponse.json(data)
  } catch (error) {
    return relayOrchestratorError(error, 'Failed to test notification channel')
  }
}
