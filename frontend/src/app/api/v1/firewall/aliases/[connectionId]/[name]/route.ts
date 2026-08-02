export const dynamic = "force-dynamic"
// src/app/api/v1/firewall/aliases/[connectionId]/[name]/route.ts
import { NextRequest, NextResponse } from 'next/server'

import { getOrchestratorClient } from '@/lib/orchestrator/client'
import { verifyConnectionOwnership } from '@/lib/tenant'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { getConnectionById } from '@/lib/connections/getConnection'
import { orchestratorOrPve } from '@/lib/firewall/withPveFallback'
import * as pveDirect from '@/lib/firewall/pveDirect'

// PUT /api/v1/firewall/aliases/[connectionId]/[name] - Update alias
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ connectionId: string; name: string }> }
) {
  try {
    const { connectionId, name } = await params
    const ownershipDenied = await verifyConnectionOwnership(connectionId)
    if (ownershipDenied) return ownershipDenied

    const denied = await checkPermission(PERMISSIONS.NODE_MANAGE, "connection", connectionId)
    if (denied) return denied

    const body = await request.json()

    const orchestrator = getOrchestratorClient()
    const updated = await orchestratorOrPve(
      'firewall/aliases',
      () => orchestrator.put(`/firewall/aliases/${connectionId}/${name}`, body),
      async () => pveDirect.updateAlias(await getConnectionById(connectionId), name, body),
    )

    return NextResponse.json(updated)
  } catch (error: any) {
    console.error('Error updating alias:', error)
    
return NextResponse.json(
      { error: error.message || 'Failed to update alias' },
      { status: 500 }
    )
  }
}

// DELETE /api/v1/firewall/aliases/[connectionId]/[name] - Delete alias
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ connectionId: string; name: string }> }
) {
  try {
    const { connectionId, name } = await params
    const ownershipDenied = await verifyConnectionOwnership(connectionId)
    if (ownershipDenied) return ownershipDenied

    const denied = await checkPermission(PERMISSIONS.NODE_MANAGE, "connection", connectionId)
    if (denied) return denied

    const orchestrator = getOrchestratorClient()

    await orchestratorOrPve(
      'firewall/aliases',
      () => orchestrator.delete(`/firewall/aliases/${connectionId}/${name}`),
      async () => pveDirect.deleteAlias(await getConnectionById(connectionId), name),
    )

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error('Error deleting alias:', error)
    
return NextResponse.json(
      { error: error.message || 'Failed to delete alias' },
      { status: 500 }
    )
  }
}
