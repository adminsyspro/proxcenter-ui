// src/app/api/v1/firewall/microseg/[connectionId]/vm/[node]/[vmType]/[vmid]/isolate/route.ts
import { NextRequest, NextResponse } from 'next/server'

import { getOrchestratorClient } from '@/lib/orchestrator/client'
import { verifyConnectionOwnership } from '@/lib/tenant'

type Params = { connectionId: string; node: string; vmType: string; vmid: string }

// POST - Isolate VM
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<Params> }
) {
  try {
    const { connectionId, node, vmType, vmid } = await params
    const ownershipDenied = await verifyConnectionOwnership(connectionId)
    if (ownershipDenied) return ownershipDenied
    const body = await request.json()
    
    const orchestrator = getOrchestratorClient()

    const response = await orchestrator.post(
      `/firewall/microseg/${connectionId}/vm/${node}/${vmType}/${vmid}/isolate`,
      body
    )

    
return NextResponse.json(response.data)
  } catch (error: any) {
    console.error('Error isolating VM:', error)
    
return NextResponse.json(
      { error: error.message || 'Failed to isolate VM' },
      { status: 500 }
    )
  }
}
