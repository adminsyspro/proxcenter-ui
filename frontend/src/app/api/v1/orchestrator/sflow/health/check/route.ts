import { NextResponse } from 'next/server'

import { orchestratorFetch } from '@/lib/orchestrator/client'
import { demoResponse } from '@/lib/demo/demo-api'
import { PERMISSIONS } from '@/lib/rbac'
import { requireProviderAdmin } from '@/lib/tenant/providerGuard'

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
    // Judged on the principal's own tenant, not getCurrentTenantId(), whose
    // fallback to `default` would let a stale tenant session through.
    const denied = await requireProviderAdmin(PERMISSIONS.ADMIN_SETTINGS)
    if (denied) return denied

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
