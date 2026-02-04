// src/app/api/v1/firewall/cluster/[connectionId]/rules/[pos]/route.ts
import { NextRequest, NextResponse } from 'next/server'

import { getOrchestratorClient } from '@/lib/orchestrator/client'

// PUT /api/v1/firewall/cluster/[connectionId]/rules/[pos] - Update/move cluster rule
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ connectionId: string; pos: string }> }
) {
  try {
    const { connectionId, pos } = await params
    const body = await request.json()

    const orchestrator = getOrchestratorClient()
    const response = await orchestrator.put(`/firewall/cluster/${connectionId}/rules/${pos}`, body)

    return NextResponse.json(response.data)
  } catch (error: any) {
    console.error('Error updating cluster rule:', error)
    
return NextResponse.json(
      { error: error.message || 'Failed to update cluster rule' },
      { status: 500 }
    )
  }
}

// DELETE /api/v1/firewall/cluster/[connectionId]/rules/[pos] - Delete cluster rule
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ connectionId: string; pos: string }> }
) {
  try {
    const { connectionId, pos } = await params

    const orchestrator = getOrchestratorClient()

    await orchestrator.delete(`/firewall/cluster/${connectionId}/rules/${pos}`)

    return NextResponse.json({ status: 'deleted' })
  } catch (error: any) {
    console.error('Error deleting cluster rule:', error)
    
return NextResponse.json(
      { error: error.message || 'Failed to delete cluster rule' },
      { status: 500 }
    )
  }
}
