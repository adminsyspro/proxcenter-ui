// src/app/api/v1/orchestrator/drs/rules/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server'

import { getOrchestratorClient } from '@/lib/orchestrator/client'
import { isTenantRuleConnection, mayActOnDrsRule } from '@/lib/orchestrator/drsRuleScope'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { withAudit } from '@/lib/audit/withAudit'

export const runtime = "nodejs"

interface RouteParams {
  params: Promise<{ id: string }>
}

// PUT /api/v1/orchestrator/drs/rules/:id — tenant-scoped
async function handlePut(request: NextRequest, { params }: RouteParams) {
  try {
    const denied = await checkPermission(PERMISSIONS.AUTOMATION_MANAGE)
    if (denied) return denied

    const { id } = await params
    const client = getOrchestratorClient()
    if (!client) return NextResponse.json({ error: 'Orchestrator not configured' }, { status: 503 })

    if (!(await mayActOnDrsRule(client, id))) {
      return NextResponse.json({ error: 'Rule not found' }, { status: 404 })
    }

    const body = await request.json()
    const rule: any = { ...body }
    if (rule.connectionId !== undefined) {
      rule.connection_id = rule.connectionId
      delete rule.connectionId
    }
    // Moving a rule is creating it on the new cluster: same tenant check.
    if (rule.connection_id !== undefined && !(await isTenantRuleConnection(rule.connection_id))) {
      return NextResponse.json({ error: 'Connection not found' }, { status: 404 })
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
async function handleDelete(request: NextRequest, { params }: RouteParams) {
  try {
    const denied = await checkPermission(PERMISSIONS.AUTOMATION_MANAGE)
    if (denied) return denied

    const { id } = await params
    const client = getOrchestratorClient()
    if (!client) return NextResponse.json({ error: 'Orchestrator not configured' }, { status: 503 })

    if (!(await mayActOnDrsRule(client, id))) {
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

export const PUT = withAudit({ category: 'automation', resourceType: 'rule', resourceParam: 'id' }, handlePut)
export const DELETE = withAudit({ category: 'automation', resourceType: 'rule', resourceParam: 'id' }, handleDelete)
