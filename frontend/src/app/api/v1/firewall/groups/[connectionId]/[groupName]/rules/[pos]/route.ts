export const dynamic = "force-dynamic"
// src/app/api/v1/firewall/groups/[connectionId]/[groupName]/rules/[pos]/route.ts
import { NextRequest, NextResponse } from 'next/server'

import { getOrchestratorClient } from '@/lib/orchestrator/client'
import { getConnectionById } from '@/lib/connections/getConnection'
import * as pveDirect from '@/lib/firewall/pveDirect'
import { orchestratorOrPve } from '@/lib/firewall/withPveFallback'
import { verifyConnectionOwnership } from '@/lib/tenant'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'

// PUT /api/v1/firewall/groups/[connectionId]/[groupName]/rules/[pos] - Update rule
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ connectionId: string; groupName: string; pos: string }> }
) {
  try {
    const { connectionId, groupName, pos } = await params
    const ownershipDenied = await verifyConnectionOwnership(connectionId)
    if (ownershipDenied) return ownershipDenied

    const denied = await checkPermission(PERMISSIONS.NODE_MANAGE, "connection", connectionId)
    if (denied) return denied

    const body = await request.json()

    const orchestrator = getOrchestratorClient()

    // Community has no orchestrator: update the rule straight on PVE (#616).
    await orchestratorOrPve(
      'firewall/groups/rules',
      () => orchestrator.put(`/firewall/groups/${connectionId}/${groupName}/rules/${pos}`, body),
      async () => pveDirect.updateSecurityGroupRule(await getConnectionById(connectionId), groupName, pos, body),
    )

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
    const ownershipDenied = await verifyConnectionOwnership(connectionId)
    if (ownershipDenied) return ownershipDenied

    const denied = await checkPermission(PERMISSIONS.NODE_MANAGE, "connection", connectionId)
    if (denied) return denied

    const orchestrator = getOrchestratorClient()

    await orchestratorOrPve(
      'firewall/groups/rules',
      () => orchestrator.delete(`/firewall/groups/${connectionId}/${groupName}/rules/${pos}`),
      async () => pveDirect.deleteSecurityGroupRule(await getConnectionById(connectionId), groupName, pos),
    )

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Error deleting rule:', error)
    
return NextResponse.json(
      { error: error.message || 'Failed to delete rule' },
      { status: 500 }
    )
  }
}
