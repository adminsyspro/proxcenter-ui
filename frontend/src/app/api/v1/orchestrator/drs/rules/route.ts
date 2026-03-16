// src/app/api/v1/orchestrator/drs/rules/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'

import { getOrchestratorClient } from '@/lib/orchestrator/client'
import { getTenantConnectionIds } from '@/lib/tenant'

export const runtime = "nodejs"

// Transform frontend camelCase body to orchestrator snake_case
function toOrchestratorFormat(body: any) {
  return {
    id: body.id || randomUUID(),
    name: body.name,
    type: body.type,
    connection_id: body.connectionId || body.connection_id || '',
    enabled: body.enabled ?? true,
    required: body.required ?? false,
    vmids: body.vmids || [],
    nodes: body.nodes || [],
    from_tag: body.fromTag || body.from_tag || false,
    from_pool: body.fromPool || body.from_pool || false,
  }
}

// GET /api/v1/orchestrator/drs/rules — tenant-filtered
export async function GET() {
  try {
    const client = getOrchestratorClient()
    if (!client) return NextResponse.json([])

    const tenantConnectionIds = await getTenantConnectionIds()
    const response = await client.getRules()

    const all = Array.isArray(response.data) ? response.data : []
    const filtered = all.filter((r: any) => !r.connection_id || tenantConnectionIds.has(r.connection_id))

    return NextResponse.json(filtered)
  } catch (error: any) {
    if ((error as any)?.code !== 'ORCHESTRATOR_UNAVAILABLE') {
      console.error('Failed to fetch affinity rules:', error)
    }

    return NextResponse.json([])
  }
}

// POST /api/v1/orchestrator/drs/rules
export async function POST(request: NextRequest) {
  try {
    const client = getOrchestratorClient()

    if (!client) {
      return NextResponse.json(
        { error: 'Orchestrator not configured' },
        { status: 503 }
      )
    }

    const body = await request.json()
    const rule = toOrchestratorFormat(body)

    // Validate connection belongs to current tenant
    const tenantConnectionIds = await getTenantConnectionIds()
    if (rule.connection_id && !tenantConnectionIds.has(rule.connection_id)) {
      return NextResponse.json({ error: 'Connection not found' }, { status: 404 })
    }

    const response = await client.createRule(rule)

    return NextResponse.json(response.data)
  } catch (error: any) {
    if ((error as any)?.code !== 'ORCHESTRATOR_UNAVAILABLE') {
      console.error('Failed to create affinity rule:', error)
    }

    return NextResponse.json(
      { error: error.message || 'Failed to create rule' },
      { status: 500 }
    )
  }
}
