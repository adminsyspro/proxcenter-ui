import { NextResponse } from 'next/server'

import { orchestratorFetch } from '@/lib/orchestrator/client'
import { demoResponse } from '@/lib/demo/demo-api'
import { PERMISSIONS } from '@/lib/rbac'
import { requireProviderAdmin } from '@/lib/tenant/providerGuard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/v1/orchestrator/alerts/backup-coverage/check
 *
 * Asks the orchestrator for an immediate backup coverage pass (roadmap#48),
 * so the alerts follow a settings change without waiting for the hourly task.
 * The orchestrator answers 202 at once and runs the pass in the background,
 * never two at a time ({ started: false } when one is already running).
 * Same gate as the coverage settings it follows: admin settings, provider only.
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
      // Community: no orchestrator, hence no alert to refresh.
      return NextResponse.json({ started: false, reason: 'no_orchestrator' }, { status: 202 })
    }

    const result = await orchestratorFetch<{ started?: boolean }>('/alerts/backup-coverage/check', { method: 'POST' })

    return NextResponse.json({ started: !!result?.started }, { status: 202 })
  } catch (error: any) {
    if (error?.code !== 'ORCHESTRATOR_UNAVAILABLE') {
      console.error('[orchestrator/alerts/backup-coverage/check] POST error:', error)
    }
    return NextResponse.json({ error: error?.message || 'Failed to start the backup coverage check' }, { status: 502 })
  }
}
