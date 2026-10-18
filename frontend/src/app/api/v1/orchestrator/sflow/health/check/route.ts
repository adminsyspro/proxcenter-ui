import { NextResponse } from 'next/server'

import { orchestratorFetch } from '@/lib/orchestrator/client'
import { demoResponse } from '@/lib/demo/demo-api'
import { DEFAULT_TENANT_ID, getCurrentTenantId } from '@/lib/tenant'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/v1/orchestrator/sflow/health/check
 *
 * Asks the orchestrator for an immediate sFlow telemetry pass (roadmap#52), so
 * a change of the timeout, the grace period or the toggle takes effect now
 * rather than at the next 30 s tick. Same gate as the alert settings it
 * follows: admin settings, provider only, since the collector is fleet-wide.
 */
export async function POST(req: Request) {
  const demo = demoResponse(req)
  if (demo) return demo

  try {
    const denied = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)
    if (denied) return denied

    if ((await getCurrentTenantId()) !== DEFAULT_TENANT_ID) {
      return NextResponse.json({ error: 'Provider only' }, { status: 403 })
    }

    if (!process.env.ORCHESTRATOR_URL) {
      // Community: no orchestrator, hence no collector to check.
      return NextResponse.json({ started: false, reason: 'no_orchestrator' }, { status: 202 })
    }

    await orchestratorFetch('/sflow/health/check', { method: 'POST' })

    return NextResponse.json({ started: true }, { status: 202 })
  } catch (error: any) {
    if (error?.code !== 'ORCHESTRATOR_UNAVAILABLE') {
      console.error('[orchestrator/sflow/health/check] POST error:', error)
    }
    return NextResponse.json({ error: error?.message || 'Failed to start the sFlow telemetry check' }, { status: 502 })
  }
}
