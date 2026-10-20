export const dynamic = "force-dynamic"
// src/app/api/v1/firewall/nodes/[connectionId]/[node]/rules/[pos]/route.ts
import { NextRequest, NextResponse } from 'next/server'

import { getOrchestratorClient } from '@/lib/orchestrator/client'
import { verifyConnectionOwnership } from '@/lib/tenant'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { withPublicApiGuard } from '@/lib/api-tokens/routeGuard'
import { getConnectionById } from '@/lib/connections/getConnection'
import { orchestratorOrPve } from '@/lib/firewall/withPveFallback'
import * as pveDirect from '@/lib/firewall/pveDirect'
import { withAudit } from '@/lib/audit/withAudit'

// PUT /api/v1/firewall/nodes/[connectionId]/[node]/rules/[pos] - Update/move node rule
async function putHandler(
  request: NextRequest,
  { params }: { params: Promise<{ connectionId: string; node: string; pos: string }> }
) {
  try {
    const { connectionId, node, pos } = await params
    const ownershipDenied = await verifyConnectionOwnership(connectionId)
    if (ownershipDenied) return ownershipDenied

    const denied = await checkPermission(PERMISSIONS.NODE_MANAGE, "connection", connectionId)
    if (denied) return denied

    const body = await request.json()

    const orchestrator = getOrchestratorClient()
    const result = await orchestratorOrPve(
      'firewall/nodes',
      () => orchestrator.put(`/firewall/nodes/${connectionId}/${node}/rules/${pos}`, body),
      async () => pveDirect.updateNodeRule(await getConnectionById(connectionId), node, pos, body),
    )

    return NextResponse.json(result)
  } catch (error: any) {
    console.error('Error updating node rule:', error)
    
return NextResponse.json(
      { error: error.message || 'Failed to update node rule' },
      { status: 500 }
    )
  }
}

// DELETE /api/v1/firewall/nodes/[connectionId]/[node]/rules/[pos] - Delete node rule
async function deleteHandler(
  request: NextRequest,
  { params }: { params: Promise<{ connectionId: string; node: string; pos: string }> }
) {
  try {
    const { connectionId, node, pos } = await params
    const ownershipDenied = await verifyConnectionOwnership(connectionId)
    if (ownershipDenied) return ownershipDenied

    const denied = await checkPermission(PERMISSIONS.NODE_MANAGE, "connection", connectionId)
    if (denied) return denied

    const orchestrator = getOrchestratorClient()

    // Result discarded on purpose: this handler has always answered with its
    // own literal body, on both paths.
    await orchestratorOrPve(
      'firewall/nodes',
      () => orchestrator.delete(`/firewall/nodes/${connectionId}/${node}/rules/${pos}`),
      async () => pveDirect.deleteNodeRule(await getConnectionById(connectionId), node, pos),
    )

    return NextResponse.json({ status: 'deleted' })
  } catch (error: any) {
    console.error('Error deleting node rule:', error)
    
return NextResponse.json(
      { error: error.message || 'Failed to delete node rule' },
      { status: 500 }
    )
  }
}

export const PUT = withAudit({ category: 'firewall', resourceType: 'rule', resourceParam: 'pos' }, withPublicApiGuard("fw-node-rule-update", putHandler))
export const DELETE = withAudit({ category: 'firewall', resourceType: 'rule', resourceParam: 'pos' }, withPublicApiGuard("fw-node-rule-delete", deleteHandler))
