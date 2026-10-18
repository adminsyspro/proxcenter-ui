export const dynamic = "force-dynamic"
// src/app/api/v1/firewall/ipsets/[connectionId]/[ipsetName]/entries/[cidr]/route.ts
import { NextRequest, NextResponse } from 'next/server'

import { getOrchestratorClient } from '@/lib/orchestrator/client'
import { verifyConnectionOwnership } from '@/lib/tenant'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { withPublicApiGuard } from '@/lib/api-tokens/routeGuard'
import { getConnectionById } from '@/lib/connections/getConnection'
import { orchestratorOrPve } from '@/lib/firewall/withPveFallback'
import * as pveDirect from '@/lib/firewall/pveDirect'
import { residualEscapeRefusal } from '@/lib/api/pathParam'

// DELETE /api/v1/firewall/ipsets/[connectionId]/[ipsetName]/entries/[cidr] - Delete entry
async function deleteHandler(
  request: NextRequest,
  { params }: { params: Promise<{ connectionId: string; ipsetName: string; cidr: string }> }
) {
  try {
    const { connectionId, ipsetName, cidr } = await params
    const ownershipDenied = await verifyConnectionOwnership(connectionId)
    if (ownershipDenied) return ownershipDenied

    const denied = await checkPermission(PERMISSIONS.NODE_MANAGE, "connection", connectionId)
    if (denied) return denied

    const malformed = residualEscapeRefusal(cidr, 'CIDR')
    if (malformed) return malformed
    const decodedCidr = cidr

    const orchestrator = getOrchestratorClient()

    await orchestratorOrPve(
      'firewall/ipsets/entries',
      () => orchestrator.delete(`/firewall/ipsets/${connectionId}/${ipsetName}/entries/${encodeURIComponent(decodedCidr)}`),
      // pveDirect escapes the CIDR itself, so it gets the decoded value
      async () => pveDirect.deleteIPSetEntry(await getConnectionById(connectionId), ipsetName, decodedCidr),
    )

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Error deleting IP set entry:', error)
    
return NextResponse.json(
      { error: error.message || 'Failed to delete entry' },
      { status: 500 }
    )
  }
}

export const DELETE = withPublicApiGuard("fw-ipset-entry-delete", deleteHandler)
