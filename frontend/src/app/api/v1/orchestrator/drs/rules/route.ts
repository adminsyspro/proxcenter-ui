// src/app/api/v1/orchestrator/drs/rules/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { randomUUID } from 'crypto'

import { getOrchestratorClient } from '@/lib/orchestrator/client'

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

// GET /api/v1/orchestrator/drs/rules
export async function GET() {
  try {
    const client = getOrchestratorClient()

    if (!client) {
      return NextResponse.json([])
    }

    const response = await client.getRules()

    return NextResponse.json(response.data || [])
  } catch (error: any) {
    console.error('Failed to fetch affinity rules:', error)

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
    const response = await client.createRule(rule)

    return NextResponse.json(response.data)
  } catch (error: any) {
    console.error('Failed to create affinity rule:', error)

    return NextResponse.json(
      { error: error.message || 'Failed to create rule' },
      { status: 500 }
    )
  }
}
