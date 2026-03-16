// src/app/api/v1/orchestrator/drs/rules/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server'

import { getOrchestratorClient } from '@/lib/orchestrator/client'
import { getTenantConnectionIds } from '@/lib/tenant'

export const runtime = "nodejs"

interface RouteParams {
  params: Promise<{ id: string }>
}

async function verifyDrsRuleBelongsToTenant(client: any, id: string): Promise<boolean> {
  const rulesRes = await client.getRules()
  const rules = Array.isArray(rulesRes.data) ? rulesRes.data : []
  const rule = rules.find((r: any) => r.id === id)
  if (rule?.connection_id) {
    const tenantConnectionIds = await getTenantConnectionIds()
    return tenantConnectionIds.has(rule.connection_id)
  }
  return true // no connection_id = global rule
}

// PUT /api/v1/orchestrator/drs/rules/:id — tenant-scoped
export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params
    const client = getOrchestratorClient()
    if (!client) return NextResponse.json({ error: 'Orchestrator not configured' }, { status: 503 })

    if (!(await verifyDrsRuleBelongsToTenant(client, id))) {
      return NextResponse.json({ error: 'Rule not found' }, { status: 404 })
    }

    const body = await request.json()
    const rule: any = { ...body }
    if (rule.connectionId !== undefined) {
      rule.connection_id = rule.connectionId
      delete rule.connectionId
    }
    if (rule.fromTag !== undefined) {
      rule.from_tag = rule.fromTag
      delete rule.fromTag
    }
    if (rule.fromPool !== undefined) {
      rule.from_pool = rule.fromPool
      delete rule.fromPool
    }
    const response = await client.updateRule(id, rule)

    return NextResponse.json(response.data)
  } catch (error: any) {
    if ((error as any)?.code !== 'ORCHESTRATOR_UNAVAILABLE') {
      console.error('Failed to update affinity rule:', error)
    }

    return NextResponse.json(
      { error: error.message || 'Failed to update rule' },
      { status: 500 }
    )
  }
}

// DELETE /api/v1/orchestrator/drs/rules/:id — tenant-scoped
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params
    const client = getOrchestratorClient()
    if (!client) return NextResponse.json({ error: 'Orchestrator not configured' }, { status: 503 })

    if (!(await verifyDrsRuleBelongsToTenant(client, id))) {
      return NextResponse.json({ error: 'Rule not found' }, { status: 404 })
    }

    await client.deleteRule(id)

    return NextResponse.json({ success: true })
  } catch (error: any) {
    if ((error as any)?.code !== 'ORCHESTRATOR_UNAVAILABLE') {
      console.error('Failed to delete affinity rule:', error)
    }

    return NextResponse.json(
      { error: error.message || 'Failed to delete rule' },
      { status: 500 }
    )
  }
}
