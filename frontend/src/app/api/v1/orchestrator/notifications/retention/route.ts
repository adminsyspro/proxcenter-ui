import { NextResponse } from 'next/server'

import { orchestratorFetch } from '@/lib/orchestrator/client'
import { PERMISSIONS } from '@/lib/rbac'
import { requireProviderAdmin } from '@/lib/tenant/providerGuard'
import { withAudit } from '@/lib/audit/withAudit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function failure(error: any) {
  if (error?.code !== 'ORCHESTRATOR_UNAVAILABLE') {
    console.error('[notifications/retention] error:', error)
  }

  return NextResponse.json({ error: error?.message || 'Server error' }, { status: 500 })
}

/**
 * How long the orchestrator keeps the notification history. One value for
 * the whole platform, like the notification settings themselves: provider
 * administrators only.
 */
export async function GET() {
  const denied = await requireProviderAdmin(PERMISSIONS.ADMIN_SETTINGS)
  if (denied) return denied

  try {
    return NextResponse.json(await orchestratorFetch<any>('/notifications/retention'))
  } catch (error: any) {
    return failure(error)
  }
}

async function handlePut(req: Request) {
  const denied = await requireProviderAdmin(PERMISSIONS.ADMIN_SETTINGS)
  if (denied) return denied

  const body = await req.json().catch(() => null)
  const retentionDays = Number(body?.retentionDays)

  if (!Number.isInteger(retentionDays) || retentionDays < 1) {
    return NextResponse.json({ error: 'retentionDays must be a whole number of days' }, { status: 400 })
  }

  try {
    const data = await orchestratorFetch<any>('/notifications/retention', { method: 'PUT', body: { retentionDays } })

    return NextResponse.json(data)
  } catch (error: any) {
    return failure(error)
  }
}

export const PUT = withAudit({ category: 'security', resourceType: 'setting' }, handlePut)
