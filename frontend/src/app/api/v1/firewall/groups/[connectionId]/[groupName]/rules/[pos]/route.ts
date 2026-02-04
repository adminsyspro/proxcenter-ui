// src/app/api/v1/firewall/groups/[connectionId]/[groupName]/rules/[pos]/route.ts
import { NextRequest, NextResponse } from 'next/server'

import { getOrchestratorClient } from '@/lib/orchestrator/client'

// PUT /api/v1/firewall/groups/[connectionId]/[groupName]/rules/[pos] - Update rule
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ connectionId: string; groupName: string; pos: string }> }
) {
  try {
    const { connectionId, groupName, pos } = await params
    const body = await request.json()

    const orchestrator = getOrchestratorClient()

    await orchestrator.put(`/firewall/groups/${connectionId}/${groupName}/rules/${pos}`, body)

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Error updating rule:', error)
    
return NextResponse.json(
      { error: error.message || 'Failed to update rule' },
      { status: 500 }
    )
  }
}

// DELETE /api/v1/firewall/groups/[connectionId]/[groupName]/rules/[pos] - Delete rule
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ connectionId: string; groupName: string; pos: string }> }
) {
  try {
    const { connectionId, groupName, pos } = await params

    const orchestrator = getOrchestratorClient()

    await orchestrator.delete(`/firewall/groups/${connectionId}/${groupName}/rules/${pos}`)

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Error deleting rule:', error)
    
return NextResponse.json(
      { error: error.message || 'Failed to delete rule' },
      { status: 500 }
    )
  }
}
