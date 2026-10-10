export const dynamic = "force-dynamic"
import { NextRequest, NextResponse } from 'next/server'

import { orchestratorFetch, parseOrchestratorError } from '@/lib/orchestrator'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'

// Notification channels (Slack, Teams, ntfy, Discord, generic webhook) live
// in the orchestrator next to the email settings; these routes only relay.
// Secrets go one way: the orchestrator answers with a masked URL and flags.

// Validation answers (400, 404) from the orchestrator are passed through so
// the dialog shows the actual reason instead of a generic failure.
function relayError(error: any, fallback: string) {
  const upstream = parseOrchestratorError(error)

  if (upstream && upstream.status >= 400 && upstream.status < 500) {
    return NextResponse.json({ error: upstream.message }, { status: upstream.status })
  }

  if ((error as any)?.code !== 'ORCHESTRATOR_UNAVAILABLE') {
    console.error(fallback, error)
  }

  return NextResponse.json({ error: error?.message || fallback }, { status: 500 })
}

export async function GET() {
  // Channels are global (orchestrator not tenant-aware): admins only, like the settings.
  const denied = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)
  if (denied) return denied

  try {
    const data = await orchestratorFetch('/notifications/channels')

    return NextResponse.json(data)
  } catch (error: any) {
    return relayError(error, 'Failed to list notification channels')
  }
}

export async function POST(request: NextRequest) {
  const denied = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)
  if (denied) return denied

  try {
    const body = await request.json()

    const data = await orchestratorFetch('/notifications/channels', {
      method: 'POST',
      body
    })

    return NextResponse.json(data, { status: 201 })
  } catch (error: any) {
    return relayError(error, 'Failed to create notification channel')
  }
}
