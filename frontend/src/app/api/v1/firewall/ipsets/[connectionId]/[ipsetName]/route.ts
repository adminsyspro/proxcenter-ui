export const dynamic = "force-dynamic"
// src/app/api/v1/firewall/ipsets/[connectionId]/[ipsetName]/route.ts
import { NextRequest, NextResponse } from 'next/server'

import { getOrchestratorClient } from '@/lib/orchestrator/client'
import { verifyConnectionOwnership } from '@/lib/tenant'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { getConnectionById } from '@/lib/connections/getConnection'
import { orchestratorOrPve } from '@/lib/firewall/withPveFallback'
import * as pveDirect from '@/lib/firewall/pveDirect'

// DELETE /api/v1/firewall/ipsets/[connectionId]/[ipsetName] - Delete IP set
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ connectionId: string; ipsetName: string }> }
) {
  try {
    const { connectionId, ipsetName } = await params
    const ownershipDenied = await verifyConnectionOwnership(connectionId)
    if (ownershipDenied) return ownershipDenied

    const denied = await checkPermission(PERMISSIONS.NODE_MANAGE, "connection", connectionId)
    if (denied) return denied

    const orchestrator = getOrchestratorClient()

    await orchestratorOrPve(
      'firewall/ipsets',
      () => orchestrator.delete(`/firewall/ipsets/${connectionId}/${ipsetName}`),
      async () => pveDirect.deleteIPSet(await getConnectionById(connectionId), ipsetName),
    )

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Error deleting IP set:', error)
    
return NextResponse.json(
      { error: error.message || 'Failed to delete IP set' },
      { status: 500 }
    )
  }
}
