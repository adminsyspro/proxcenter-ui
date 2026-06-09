import { NextResponse } from 'next/server'

import { orchestratorFetch } from '@/lib/orchestrator/client'
import { demoResponse } from '@/lib/demo/demo-api'
import { getCurrentTenantId, getTenantConnectionIds, getSessionPrisma, DEFAULT_TENANT_ID } from '@/lib/tenant'
import { getTenantInfrastructureScope } from '@/lib/tenant/infraScope'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { ruleVisibleToTenant, setRuleOwner } from '@/lib/alerts/ruleOwners'
import { injectVdcNodeScope } from '@/lib/alerts/ruleScope'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/v1/orchestrator/alerts/rules
 * Liste les règles d'événements (filtrées par tenant)
 */
export async function GET(req: Request) {
  const demo = demoResponse(req)
  if (demo) return demo

  try {
    // CONNECTION_VIEW baseline (same as /alerts) — vDC tenants need to see
    // and manage their own rules but don't carry alerts.view in their role.
    const denied = await checkPermission(PERMISSIONS.CONNECTION_VIEW)
    if (denied) return denied

    const tenantId = await getCurrentTenantId()
    const rules = await orchestratorFetch('/alerts/rules')

    // Filter by ownership stored in alert_rule_owners. The orchestrator
    // doesn't carry tenant_id on rules, so this local map is the only
    // source of truth for "who created this rule".
    const allRules = Array.isArray(rules) ? rules : ((rules as any)?.data || [])
    const filtered = Array.isArray(allRules)
      ? (await Promise.all(allRules.map(async (r: any) => ({ r, visible: await ruleVisibleToTenant(r.id, tenantId) })))).filter(x => x.visible).map(x => x.r)
      : allRules

    return NextResponse.json(filtered)
  } catch (error: any) {
    if ((error as any)?.code !== 'ORCHESTRATOR_UNAVAILABLE') {
      console.error('[orchestrator/alerts/rules] GET error:', error)
    }
    
    if (error.message?.includes('ECONNREFUSED') || error.message?.includes('timeout')) {
      return NextResponse.json([])
    }

    return NextResponse.json(
      { error: error?.message || 'Failed to fetch rules' },
      { status: 500 }
    )
  }
}

/**
 * POST /api/v1/orchestrator/alerts/rules
 * Crée une nouvelle règle
 */
export async function POST(req: Request) {
  const demo = demoResponse(req)
  if (demo) return demo

  try {
    // Relaxed from ALERTS_MANAGE so vDC tenants can author rules on their
    // own scope. The body-level checks below enforce that they cannot
    // create global rules and cannot escape their connection scope.
    const denied = await checkPermission(PERMISSIONS.CONNECTION_VIEW)
    if (denied) return denied

    const body = await req.json()
    const tenantId = await getCurrentTenantId()
    const isVdcTenant = tenantId !== DEFAULT_TENANT_ID

    // For non-default tenants the rule form has no connection picker -- auto-fill
    // from the tenant's infrastructure scope. MSP tenants own connections
    // directly (infra.connectionIds); IaaS tenants slice provider clusters via
    // vDCs (infra.vdcScope.connectionIds). Alert rules react to PVE tasks/events,
    // so we pick from the PVE side of the scope only (not PBS bindings).
    if (isVdcTenant && !body.connection_id) {
      const infra = await getTenantInfrastructureScope(tenantId)
      let pveIds: string[]
      if (infra.kind === 'msp') {
        // MSP tenants own connections directly but those may include PBS or
        // external connections. Alert rules are PVE-only, so query only the
        // PVE connections the session-scoped Prisma client can see (already
        // restricted to the MSP tenant's owned connections).
        const prisma = await getSessionPrisma()
        const ownedPve = await prisma.connection.findMany({ where: { type: 'pve' }, select: { id: true } })
        pveIds = ownedPve.map((c: any) => c.id)
      } else if (infra.kind === 'iaas') {
        // IaaS vDC scope is already PVE-only.
        pveIds = [...infra.vdcScope.connectionIds]
      } else {
        pveIds = []
      }
      if (pveIds.length === 1) {
        body.connection_id = pveIds[0]
      } else if (pveIds.length === 0) {
        return NextResponse.json(
          { error: 'No cluster available in your scope' },
          { status: 400 }
        )
      } else {
        return NextResponse.json(
          { error: 'Multiple clusters in scope; please specify connection_id explicitly' },
          { status: 400 }
        )
      }
    }

    // Validate connection_id belongs to current tenant
    if (body.connection_id) {
      const tenantConnectionIds = await getTenantConnectionIds()

      if (!tenantConnectionIds.has(body.connection_id)) {
        return NextResponse.json(
          { error: 'Connection not found or not owned by current tenant' },
          { status: 403 }
        )
      }
    }

    // vDC tenants: pin node_pattern to the vDC's nodes (see helper
    // docstring). Stops a tenant A rule from firing on tenant B's VMs
    // when they share a cluster.
    await injectVdcNodeScope(body, tenantId)

    const rule = await orchestratorFetch('/alerts/rules', {
      method: 'POST',
      body
    }) as any

    // Record ownership so this rule (and its alerts) are scoped to the
    // creating tenant only. Without this the provider sees vDC alerts.
    if (rule?.id) {
      try {
        await setRuleOwner(rule.id, tenantId)
      } catch (err: any) {
        console.error(`[alerts/rules] failed to record owner for rule=${rule.id}: ${err?.message ?? err}`)
      }
    }

    return NextResponse.json(rule)
  } catch (error: any) {
    if ((error as any)?.code !== 'ORCHESTRATOR_UNAVAILABLE') {
      console.error('[orchestrator/alerts/rules] POST error:', error)
    }
    
return NextResponse.json(
      { error: error?.message || 'Failed to create rule' },
      { status: 500 }
    )
  }
}
