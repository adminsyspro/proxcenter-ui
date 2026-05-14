import { NextResponse } from 'next/server'

import { orchestratorFetch } from '@/lib/orchestrator/client'
import { demoResponse } from '@/lib/demo/demo-api'
import { getCurrentTenantId, DEFAULT_TENANT_ID } from '@/lib/tenant'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { deleteRuleOwner, ruleVisibleToTenant } from '@/lib/alerts/ruleOwners'
import { injectVdcNodeScope } from '@/lib/alerts/ruleScope'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function verifyRuleBelongsToTenant(id: string): Promise<{ rule: any; allowed: boolean }> {
  const rule = await orchestratorFetch(`/alerts/rules/${id}`) as any
  const tenantId = await getCurrentTenantId()


  // Visibility is derived from alert_rule_owners. A vDC tenant only sees
  // and edits rules they authored; the provider sees everything they own
  // plus pre-migration rules that have no recorded owner.
  return { rule, allowed: await ruleVisibleToTenant(id, tenantId) }
}

/**
 * GET /api/v1/orchestrator/alerts/rules/[id]
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const demo = demoResponse(req)

  if (demo) return demo

  try {
    const denied = await checkPermission(PERMISSIONS.CONNECTION_VIEW)

    if (denied) return denied

    const { id } = await params
    const { rule, allowed } = await verifyRuleBelongsToTenant(id)

    if (!allowed) return NextResponse.json({ error: 'Rule not found' }, { status: 404 })

    return NextResponse.json(rule)
  } catch (error: any) {
    if ((error as any)?.code !== 'ORCHESTRATOR_UNAVAILABLE') {
      console.error('[orchestrator/alerts/rules/[id]] GET error:', error)
    }

    return NextResponse.json(
      { error: error?.message || 'Rule not found' },
      { status: 404 }
    )
  }
}

/**
 * PUT /api/v1/orchestrator/alerts/rules/[id]
 */
export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const demo = demoResponse(req)

  if (demo) return demo

  try {
    // Relaxed from ALERTS_MANAGE; ownership of the rule is enforced via
    // verifyRuleBelongsToTenant below, which also blocks vDC tenants from
    // touching provider-level (no connection_id) rules.
    const denied = await checkPermission(PERMISSIONS.CONNECTION_VIEW)

    if (denied) return denied

    const { id } = await params
    const { rule, allowed } = await verifyRuleBelongsToTenant(id)

    if (!allowed) return NextResponse.json({ error: 'Rule not found' }, { status: 404 })

    const body = await req.json()
    const tenantId = await getCurrentTenantId()

    // PUT bodies sometimes omit connection_id (admins editing only the
    // pattern/level). Fall back to the existing rule's connection_id so
    // node-scope injection can still run.
    if (!body.connection_id && rule?.connection_id) {
      body.connection_id = rule.connection_id
    }

    // Re-pin node_pattern to the vDC scope on every update (a tenant
    // editing an existing rule must not be able to widen its blast radius).
    if (tenantId !== DEFAULT_TENANT_ID) {
      await injectVdcNodeScope(body, tenantId)
    }

    const result = await orchestratorFetch(`/alerts/rules/${id}`, {
      method: 'PUT',
      body
    })

    return NextResponse.json(result)
  } catch (error: any) {
    if ((error as any)?.code !== 'ORCHESTRATOR_UNAVAILABLE') {
      console.error('[orchestrator/alerts/rules/[id]] PUT error:', error)
    }

    return NextResponse.json(
      { error: error?.message || 'Failed to update rule' },
      { status: 500 }
    )
  }
}

/**
 * DELETE /api/v1/orchestrator/alerts/rules/[id]
 */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const demo = demoResponse(req)

  if (demo) return demo

  try {
    // Relaxed from ALERTS_MANAGE; ownership of the rule is enforced via
    // verifyRuleBelongsToTenant below, which also blocks vDC tenants from
    // touching provider-level (no connection_id) rules.
    const denied = await checkPermission(PERMISSIONS.CONNECTION_VIEW)

    if (denied) return denied

    const { id } = await params
    const { allowed } = await verifyRuleBelongsToTenant(id)

    if (!allowed) return NextResponse.json({ error: 'Rule not found' }, { status: 404 })

    const result = await orchestratorFetch(`/alerts/rules/${id}`, {
      method: 'DELETE'
    })

    // Drop the owner row so the table doesn't accumulate stale entries.
    try { await deleteRuleOwner(id) } catch { /* tolerate */ }

    return NextResponse.json(result)
  } catch (error: any) {
    if ((error as any)?.code !== 'ORCHESTRATOR_UNAVAILABLE') {
      console.error('[orchestrator/alerts/rules/[id]] DELETE error:', error)
    }

    return NextResponse.json(
      { error: error?.message || 'Failed to delete rule' },
      { status: 500 }
    )
  }
}
