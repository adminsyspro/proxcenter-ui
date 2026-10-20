export const dynamic = "force-dynamic"
// src/app/api/v1/firewall/groups/[connectionId]/[groupName]/route.ts
import { NextRequest, NextResponse } from 'next/server'

import { getOrchestratorClient } from '@/lib/orchestrator/client'
import { getConnectionById } from '@/lib/connections/getConnection'
import * as pveDirect from '@/lib/firewall/pveDirect'
import { orchestratorOrPve } from '@/lib/firewall/withPveFallback'
import { verifyConnectionOwnership } from '@/lib/tenant'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { withPublicApiGuard } from '@/lib/api-tokens/routeGuard'
import { withAudit } from '@/lib/audit/withAudit'

// DELETE /api/v1/firewall/groups/[connectionId]/[groupName] - Delete security group
async function deleteHandler(
  request: NextRequest,
  { params }: { params: Promise<{ connectionId: string; groupName: string }> }
) {
  try {
    const { connectionId, groupName } = await params
    const ownershipDenied = await verifyConnectionOwnership(connectionId)
    if (ownershipDenied) return ownershipDenied

    const denied = await checkPermission(PERMISSIONS.NODE_MANAGE, "connection", connectionId)
    if (denied) return denied

    const orchestrator = getOrchestratorClient()

    // Community has no orchestrator: delete straight on PVE (#616).
    await orchestratorOrPve(
      'firewall/groups',
      () => orchestrator.delete(`/firewall/groups/${connectionId}/${groupName}`),
      async () => pveDirect.deleteSecurityGroup(await getConnectionById(connectionId), groupName),
    )

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Error deleting security group:', error)
    
return NextResponse.json(
      { error: error.message || 'Failed to delete security group' },
      { status: 500 }
    )
  }
}

export const DELETE = withAudit({ category: 'firewall', resourceType: 'group', resourceParam: 'groupName' }, withPublicApiGuard("fw-group-delete", deleteHandler))
