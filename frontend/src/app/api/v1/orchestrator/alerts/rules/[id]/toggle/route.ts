import { NextResponse } from 'next/server'

import { orchestratorFetch } from '@/lib/orchestrator/client'
import { demoResponse } from '@/lib/demo/demo-api'
import { getCurrentTenantId } from '@/lib/tenant'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { ruleVisibleToTenant } from '@/lib/alerts/ruleOwners'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/v1/orchestrator/alerts/rules/[id]/toggle
 * Active/désactive une règle (vérifie l'appartenance au tenant)
 */
export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const demo = demoResponse(req)

  if (demo) return demo

  try {
    // Relaxed from ALERTS_MANAGE; ownership is verified per-rule below.
    const denied = await checkPermission(PERMISSIONS.CONNECTION_VIEW)

    if (denied) return denied

    const { id } = await params

    // Visibility derives from alert_rule_owners — same scoping as the
    // [id] GET/PUT/DELETE route. 404 on mismatch to avoid existence leak.
    const tenantId = await getCurrentTenantId()

    if (!(await ruleVisibleToTenant(id, tenantId))) {
      return NextResponse.json({ error: 'Rule not found' }, { status: 404 })
    }

    const result = await orchestratorFetch(`/alerts/rules/${id}/toggle`, {
      method: 'POST'
    })

    return NextResponse.json(result)
  } catch (error: any) {
    if ((error as any)?.code !== 'ORCHESTRATOR_UNAVAILABLE') {
      console.error('[orchestrator/alerts/rules/[id]/toggle] POST error:', error)
    }

    return NextResponse.json(
      { error: error?.message || 'Failed to toggle rule' },
      { status: 500 }
    )
  }
}
