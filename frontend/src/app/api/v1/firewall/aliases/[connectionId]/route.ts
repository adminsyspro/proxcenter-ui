export const dynamic = "force-dynamic"
// src/app/api/v1/firewall/aliases/[connectionId]/route.ts
import { NextRequest, NextResponse } from 'next/server'

import { getOrchestratorClient } from '@/lib/orchestrator/client'
import { verifyConnectionOwnership } from '@/lib/tenant'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { getConnectionById } from '@/lib/connections/getConnection'
import { orchestratorOrPve } from '@/lib/firewall/withPveFallback'
import * as pveDirect from '@/lib/firewall/pveDirect'

// GET /api/v1/firewall/aliases/[connectionId] - Get all aliases
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
    const aliases = await orchestratorOrPve(
      'firewall/aliases',
      () => orchestrator.get(`/firewall/aliases/${connectionId}`),
      async () => pveDirect.getAliases(await getConnectionById(connectionId)),
    )

    return NextResponse.json(aliases)
  } catch (error: any) {
    console.error('Error fetching aliases:', error)
    
return NextResponse.json(
      { error: error.message || 'Failed to fetch aliases' },
      { status: 500 }
    )
  }
}

// POST /api/v1/firewall/aliases/[connectionId] - Create alias
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
      'firewall/aliases',
      () => orchestrator.post(`/firewall/aliases/${connectionId}`, body),
      async () => pveDirect.createAlias(await getConnectionById(connectionId), body),
    )

    return NextResponse.json(created, { status: 201 })
  } catch (error: any) {
    console.error('Error creating alias:', error)
    
return NextResponse.json(
      { error: error.message || 'Failed to create alias' },
      { status: 500 }
    )
  }
}
