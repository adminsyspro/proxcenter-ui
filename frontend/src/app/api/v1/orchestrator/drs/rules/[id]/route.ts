// src/app/api/v1/orchestrator/drs/rules/[id]/route.ts
import { NextRequest, NextResponse } from 'next/server'

import { getOrchestratorClient } from '@/lib/orchestrator/client'

export const runtime = "nodejs"

interface RouteParams {
  params: Promise<{ id: string }>
}

// PUT /api/v1/orchestrator/drs/rules/:id - Modifier une règle
export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params
    const client = getOrchestratorClient()
    
    if (!client) {
      return NextResponse.json(
        { error: 'Orchestrator not configured' },
        { status: 503 }
      )
    }

    const body = await request.json()
    // Transform camelCase to snake_case for the orchestrator
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
    console.error('Failed to update affinity rule:', error)
    
return NextResponse.json(
      { error: error.message || 'Failed to update rule' },
      { status: 500 }
    )
  }
}

// DELETE /api/v1/orchestrator/drs/rules/:id - Supprimer une règle
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const { id } = await params
    const client = getOrchestratorClient()
    
    if (!client) {
      return NextResponse.json(
        { error: 'Orchestrator not configured' },
        { status: 503 }
      )
    }

    await client.deleteRule(id)
    
return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Failed to delete affinity rule:', error)
    
return NextResponse.json(
      { error: error.message || 'Failed to delete rule' },
      { status: 500 }
    )
  }
}
