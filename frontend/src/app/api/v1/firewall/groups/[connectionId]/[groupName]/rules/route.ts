export const dynamic = "force-dynamic"
// src/app/api/v1/firewall/groups/[connectionId]/[groupName]/rules/route.ts
import { NextRequest, NextResponse } from 'next/server'

import { getOrchestratorClient } from '@/lib/orchestrator/client'
import { getConnectionById } from '@/lib/connections/getConnection'
import * as pveDirect from '@/lib/firewall/pveDirect'
import { orchestratorOrPve } from '@/lib/firewall/withPveFallback'
import { verifyConnectionOwnership } from '@/lib/tenant'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'

// POST /api/v1/firewall/groups/[connectionId]/[groupName]/rules - Add rule
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ connectionId: string; groupName: string }> }
) {
  try {
    const { connectionId, groupName } = await params
    const ownershipDenied = await verifyConnectionOwnership(connectionId)
    if (ownershipDenied) return ownershipDenied

    const denied = await checkPermission(PERMISSIONS.NODE_MANAGE, "connection", connectionId)
    if (denied) return denied

    const body = await request.json()

    const orchestrator = getOrchestratorClient()
    // Community has no orchestrator: add the rule straight on PVE (#616).
    const created = await orchestratorOrPve(
      'firewall/groups/rules',
      () => orchestrator.post(`/firewall/groups/${connectionId}/${groupName}/rules`, body),
      async () => pveDirect.addSecurityGroupRule(await getConnectionById(connectionId), groupName, body),
    )

    return NextResponse.json(created, { status: 201 })
  } catch (error: any) {
    console.error('Error adding rule:', error)
    
return NextResponse.json(
      { error: error.message || 'Failed to add rule' },
      { status: 500 }
    )
  }
}
