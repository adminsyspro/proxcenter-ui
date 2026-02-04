// src/app/api/v1/firewall/nodes/[connectionId]/[node]/rules/[pos]/route.ts
import { NextRequest, NextResponse } from 'next/server'

import { getOrchestratorClient } from '@/lib/orchestrator/client'

// PUT /api/v1/firewall/nodes/[connectionId]/[node]/rules/[pos] - Update/move node rule
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ connectionId: string; node: string; pos: string }> }
) {
  try {
    const { connectionId, node, pos } = await params
    const body = await request.json()

    const orchestrator = getOrchestratorClient()
    const response = await orchestrator.put(`/firewall/nodes/${connectionId}/${node}/rules/${pos}`, body)

    return NextResponse.json(response.data)
  } catch (error: any) {
    console.error('Error updating node rule:', error)
    
return NextResponse.json(
      { error: error.message || 'Failed to update node rule' },
      { status: 500 }
    )
  }
}

// DELETE /api/v1/firewall/nodes/[connectionId]/[node]/rules/[pos] - Delete node rule
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ connectionId: string; node: string; pos: string }> }
) {
  try {
    const { connectionId, node, pos } = await params

    const orchestrator = getOrchestratorClient()

    await orchestrator.delete(`/firewall/nodes/${connectionId}/${node}/rules/${pos}`)

    return NextResponse.json({ status: 'deleted' })
  } catch (error: any) {
    console.error('Error deleting node rule:', error)
    
return NextResponse.json(
      { error: error.message || 'Failed to delete node rule' },
      { status: 500 }
    )
  }
}
