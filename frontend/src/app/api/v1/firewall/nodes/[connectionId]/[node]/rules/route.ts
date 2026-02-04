// src/app/api/v1/firewall/nodes/[connectionId]/[node]/rules/route.ts
import { NextRequest, NextResponse } from 'next/server'

import { getOrchestratorClient } from '@/lib/orchestrator/client'

// POST /api/v1/firewall/nodes/[connectionId]/[node]/rules - Add node rule
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ connectionId: string; node: string }> }
) {
  try {
    const { connectionId, node } = await params
    const body = await request.json()

    const orchestrator = getOrchestratorClient()
    const response = await orchestrator.post(`/firewall/nodes/${connectionId}/${node}/rules`, body)

    return NextResponse.json(response.data, { status: 201 })
  } catch (error: any) {
    console.error('Error adding node rule:', error)
    
return NextResponse.json(
      { error: error.message || 'Failed to add node rule' },
      { status: 500 }
    )
  }
}
