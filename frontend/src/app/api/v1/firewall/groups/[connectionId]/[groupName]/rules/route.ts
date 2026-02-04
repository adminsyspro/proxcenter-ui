// src/app/api/v1/firewall/groups/[connectionId]/[groupName]/rules/route.ts
import { NextRequest, NextResponse } from 'next/server'

import { getOrchestratorClient } from '@/lib/orchestrator/client'

// POST /api/v1/firewall/groups/[connectionId]/[groupName]/rules - Add rule
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ connectionId: string; groupName: string }> }
) {
  try {
    const { connectionId, groupName } = await params
    const body = await request.json()

    const orchestrator = getOrchestratorClient()
    const response = await orchestrator.post(`/firewall/groups/${connectionId}/${groupName}/rules`, body)

    return NextResponse.json(response.data, { status: 201 })
  } catch (error: any) {
    console.error('Error adding rule:', error)
    
return NextResponse.json(
      { error: error.message || 'Failed to add rule' },
      { status: 500 }
    )
  }
}
