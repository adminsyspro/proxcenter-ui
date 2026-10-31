export const dynamic = "force-dynamic"
// src/app/api/v1/firewall/ipsets/[connectionId]/[ipsetName]/route.ts
import { NextRequest, NextResponse } from 'next/server'

import { getOrchestratorClient } from '@/lib/orchestrator/client'
import { verifyConnectionOwnership } from '@/lib/tenant'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { withPublicApiGuard } from '@/lib/api-tokens/routeGuard'
import { getConnectionById } from '@/lib/connections/getConnection'
import { orchestratorOrPve } from '@/lib/firewall/withPveFallback'
import * as pveDirect from '@/lib/firewall/pveDirect'
import { withAudit } from '@/lib/audit/withAudit'

// DELETE /api/v1/firewall/ipsets/[connectionId]/[ipsetName] - Delete IP set
async function deleteHandler(
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

// PUT /api/v1/firewall/ipsets/[connectionId]/[ipsetName] - Update the IP set comment
// The orchestrator exposes no IP set update, so the comment goes straight to
// PVE (POST /cluster/firewall/ipset with rename = name, see pveDirect). Same
// tenant and RBAC guards as the create route. API tokens never reach it: the
// method is not on the token allowlist, so the proxy answers 405 first.
async function putHandler(
  request: NextRequest,
  { params }: { params: Promise<{ connectionId: string; ipsetName: string }> }
) {
  try {
    const { connectionId, ipsetName } = await params
    const ownershipDenied = await verifyConnectionOwnership(connectionId)
    if (ownershipDenied) return ownershipDenied

    const denied = await checkPermission(PERMISSIONS.NODE_MANAGE, "connection", connectionId)
    if (denied) return denied

    const body = await request.json().catch(() => null)
    const comment = body?.comment ?? ''
    if (typeof comment !== 'string') {
      return NextResponse.json({ error: 'comment must be a string' }, { status: 400 })
    }

    await pveDirect.updateIPSetComment(await getConnectionById(connectionId), ipsetName, comment)

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Error updating IP set:', error)

    return NextResponse.json(
      { error: error?.message || 'Failed to update IP set' },
      { status: 500 }
    )
  }
}

export const PUT = withAudit({ category: 'firewall', resourceType: 'ipset', resourceParam: 'ipsetName' }, putHandler)
export const DELETE = withAudit({ category: 'firewall', resourceType: 'ipset', resourceParam: 'ipsetName' }, withPublicApiGuard("fw-ipset-delete", deleteHandler))
