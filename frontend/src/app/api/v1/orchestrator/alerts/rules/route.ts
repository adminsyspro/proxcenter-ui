import { NextResponse } from 'next/server'

import { orchestratorFetch } from '@/lib/orchestrator/client'
import { demoResponse } from '@/lib/demo/demo-api'
import { getTenantConnectionIds } from '@/lib/tenant'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'

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
    const denied = await checkPermission(PERMISSIONS.ALERTS_VIEW)
    if (denied) return denied

    const tenantConnectionIds = await getTenantConnectionIds()
    const rules = await orchestratorFetch('/alerts/rules')

    // Filter rules: keep global rules (no connection_id) + rules for tenant connections
    const allRules = Array.isArray(rules) ? rules : ((rules as any)?.data || [])
    const filtered = Array.isArray(allRules)
      ? allRules.filter((r: any) => !r.connection_id || tenantConnectionIds.has(r.connection_id))
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
    const denied = await checkPermission(PERMISSIONS.ALERTS_MANAGE)
    if (denied) return denied

    const body = await req.json()

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

    const rule = await orchestratorFetch('/alerts/rules', {
      method: 'POST',
      body
    })

    
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
