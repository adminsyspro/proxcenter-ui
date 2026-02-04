// src/app/api/v1/firewall/ipsets/[connectionId]/[ipsetName]/entries/route.ts
import { NextRequest, NextResponse } from 'next/server'

import { getOrchestratorClient } from '@/lib/orchestrator/client'

// POST /api/v1/firewall/ipsets/[connectionId]/[ipsetName]/entries - Add entry
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ connectionId: string; ipsetName: string }> }
) {
  try {
    const { connectionId, ipsetName } = await params
    const body = await request.json()

    const orchestrator = getOrchestratorClient()
    const response = await orchestrator.post(`/firewall/ipsets/${connectionId}/${ipsetName}/entries`, body)

    return NextResponse.json(response.data, { status: 201 })
  } catch (error: any) {
    console.error('Error adding IP set entry:', error)
    
return NextResponse.json(
      { error: error.message || 'Failed to add entry' },
      { status: 500 }
    )
  }
}
