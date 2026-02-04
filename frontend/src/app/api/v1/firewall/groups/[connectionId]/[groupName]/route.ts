// src/app/api/v1/firewall/groups/[connectionId]/[groupName]/route.ts
import { NextRequest, NextResponse } from 'next/server'

import { getOrchestratorClient } from '@/lib/orchestrator/client'

// DELETE /api/v1/firewall/groups/[connectionId]/[groupName] - Delete security group
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ connectionId: string; groupName: string }> }
) {
  try {
    const { connectionId, groupName } = await params

    const orchestrator = getOrchestratorClient()

    await orchestrator.delete(`/firewall/groups/${connectionId}/${groupName}`)

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Error deleting security group:', error)
    
return NextResponse.json(
      { error: error.message || 'Failed to delete security group' },
      { status: 500 }
    )
  }
}
