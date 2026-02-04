// src/app/api/v1/firewall/cluster/[connectionId]/rules/route.ts
import { NextRequest, NextResponse } from 'next/server'

import { getOrchestratorClient } from '@/lib/orchestrator/client'

// POST /api/v1/firewall/cluster/[connectionId]/rules - Add cluster rule
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ connectionId: string }> }
) {
  try {
    const { connectionId } = await params
    const body = await request.json()

    const orchestrator = getOrchestratorClient()
    const response = await orchestrator.post(`/firewall/cluster/${connectionId}/rules`, body)

    return NextResponse.json(response.data, { status: 201 })
  } catch (error: any) {
    console.error('Error adding cluster rule:', error)
    
return NextResponse.json(
      { error: error.message || 'Failed to add cluster rule' },
      { status: 500 }
    )
  }
}
