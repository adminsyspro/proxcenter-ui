// src/app/api/v1/firewall/ipsets/[connectionId]/[ipsetName]/route.ts
import { NextRequest, NextResponse } from 'next/server'

import { getOrchestratorClient } from '@/lib/orchestrator/client'

// DELETE /api/v1/firewall/ipsets/[connectionId]/[ipsetName] - Delete IP set
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ connectionId: string; ipsetName: string }> }
) {
  try {
    const { connectionId, ipsetName } = await params

    const orchestrator = getOrchestratorClient()

    await orchestrator.delete(`/firewall/ipsets/${connectionId}/${ipsetName}`)

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Error deleting IP set:', error)
    
return NextResponse.json(
      { error: error.message || 'Failed to delete IP set' },
      { status: 500 }
    )
  }
}
