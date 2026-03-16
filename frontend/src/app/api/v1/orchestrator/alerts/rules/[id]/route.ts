import { NextResponse } from 'next/server'

import { orchestratorFetch } from '@/lib/orchestrator/client'
import { getTenantConnectionIds } from '@/lib/tenant'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function verifyRuleBelongsToTenant(id: string): Promise<{ rule: any; allowed: boolean }> {
  const rule = await orchestratorFetch(`/alerts/rules/${id}`) as any
  if (rule?.connection_id) {
    const tenantConnectionIds = await getTenantConnectionIds()
    if (!tenantConnectionIds.has(rule.connection_id)) {
      return { rule, allowed: false }
    }
  }
  return { rule, allowed: true }
}

/**
 * GET /api/v1/orchestrator/alerts/rules/[id]
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
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
  try {
    const { id } = await params
    const { allowed } = await verifyRuleBelongsToTenant(id)
    if (!allowed) return NextResponse.json({ error: 'Rule not found' }, { status: 404 })

    const body = await req.json()
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
  try {
    const { id } = await params
    const { allowed } = await verifyRuleBelongsToTenant(id)
    if (!allowed) return NextResponse.json({ error: 'Rule not found' }, { status: 404 })

    const result = await orchestratorFetch(`/alerts/rules/${id}`, {
      method: 'DELETE'
    })

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
