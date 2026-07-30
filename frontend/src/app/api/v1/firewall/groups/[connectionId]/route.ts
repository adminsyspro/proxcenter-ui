export const dynamic = "force-dynamic"
// src/app/api/v1/firewall/groups/[connectionId]/route.ts
import { NextRequest, NextResponse } from 'next/server'

import { getOrchestratorClient } from '@/lib/orchestrator/client'
import { getConnectionById } from '@/lib/connections/getConnection'
import * as pveDirect from '@/lib/firewall/pveDirect'
import { orchestratorOrPve } from '@/lib/firewall/withPveFallback'
import { verifyConnectionOwnership } from '@/lib/tenant'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'

// GET /api/v1/firewall/groups/[connectionId] - Get all security groups
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ connectionId: string }> }
) {
  try {
    const { connectionId } = await params
    const ownershipDenied = await verifyConnectionOwnership(connectionId)
    if (ownershipDenied) return ownershipDenied

    const denied = await checkPermission(PERMISSIONS.NODE_VIEW, "connection", connectionId)
    if (denied) return denied

    const orchestrator = getOrchestratorClient()
    // Community has no orchestrator: read the groups straight from PVE (#616).
    // The connection is only loaded on that fallback path.
    const groups = await orchestratorOrPve(
      'firewall/groups',
      () => orchestrator.get(`/firewall/groups/${connectionId}`),
      async () => pveDirect.getSecurityGroups(await getConnectionById(connectionId)),
    )

    return NextResponse.json(groups)
  } catch (error: any) {
    console.error('Error fetching security groups:', error)
    
return NextResponse.json(
      { error: error.message || 'Failed to fetch security groups' },
      { status: 500 }
    )
  }
}

// POST /api/v1/firewall/groups/[connectionId] - Create security group
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ connectionId: string }> }
) {
  try {
    const { connectionId } = await params
    const ownershipDenied = await verifyConnectionOwnership(connectionId)
    if (ownershipDenied) return ownershipDenied

    const denied = await checkPermission(PERMISSIONS.NODE_MANAGE, "connection", connectionId)
    if (denied) return denied

    const body = await request.json()

    const orchestrator = getOrchestratorClient()
    const created = await orchestratorOrPve(
      'firewall/groups',
      () => orchestrator.post(`/firewall/groups/${connectionId}`, body),
      async () => pveDirect.createSecurityGroup(await getConnectionById(connectionId), body),
    )

    return NextResponse.json(created, { status: 201 })
  } catch (error: any) {
    console.error('Error creating security group:', error)
    
return NextResponse.json(
      { error: error.message || 'Failed to create security group' },
      { status: 500 }
    )
  }
}
