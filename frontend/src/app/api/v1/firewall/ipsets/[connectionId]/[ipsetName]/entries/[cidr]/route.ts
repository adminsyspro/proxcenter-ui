export const dynamic = "force-dynamic"
// src/app/api/v1/firewall/ipsets/[connectionId]/[ipsetName]/entries/[cidr]/route.ts
import { NextRequest, NextResponse } from 'next/server'

import { getOrchestratorClient } from '@/lib/orchestrator/client'
import { verifyConnectionOwnership } from '@/lib/tenant'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'

// DELETE /api/v1/firewall/ipsets/[connectionId]/[ipsetName]/entries/[cidr] - Delete entry
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ connectionId: string; ipsetName: string; cidr: string }> }
) {
  try {
    const { connectionId, ipsetName, cidr } = await params
    const ownershipDenied = await verifyConnectionOwnership(connectionId)
    if (ownershipDenied) return ownershipDenied

    const denied = await checkPermission(PERMISSIONS.NODE_MANAGE, "connection", connectionId)
    if (denied) return denied

    const decodedCidr = decodeURIComponent(cidr)

    const orchestrator = getOrchestratorClient()

    await orchestrator.delete(`/firewall/ipsets/${connectionId}/${ipsetName}/entries/${encodeURIComponent(decodedCidr)}`)

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Error deleting IP set entry:', error)
    
return NextResponse.json(
      { error: error.message || 'Failed to delete entry' },
      { status: 500 }
    )
  }
}
