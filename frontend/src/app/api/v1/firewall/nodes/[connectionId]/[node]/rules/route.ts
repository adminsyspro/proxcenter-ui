export const dynamic = "force-dynamic"
// src/app/api/v1/firewall/nodes/[connectionId]/[node]/rules/route.ts
import { NextRequest, NextResponse } from 'next/server'

import { getOrchestratorClient } from '@/lib/orchestrator/client'
import { PERMISSIONS } from '@/lib/rbac'
import { withPublicApiGuard } from '@/lib/api-tokens/routeGuard'
import { getConnectionById } from '@/lib/connections/getConnection'
import { orchestratorOrPve } from '@/lib/firewall/withPveFallback'
import * as pveDirect from '@/lib/firewall/pveDirect'
import { withAudit } from '@/lib/audit/withAudit'
import { guardProviderInfra } from '@/lib/firewall/providerInfraGuard'

// POST /api/v1/firewall/nodes/[connectionId]/[node]/rules - Add node rule
async function postHandler(
  request: NextRequest,
  { params }: { params: Promise<{ connectionId: string; node: string }> }
) {
  try {
    const { connectionId, node } = await params
    const denied = await guardProviderInfra(connectionId, PERMISSIONS.NODE_MANAGE)
    if (denied) return denied

    const body = await request.json()

    const orchestrator = getOrchestratorClient()
    const result = await orchestratorOrPve(
      'firewall/nodes',
      () => orchestrator.post(`/firewall/nodes/${connectionId}/${node}/rules`, body),
      async () => pveDirect.addNodeRule(await getConnectionById(connectionId), node, body),
    )

    return NextResponse.json(result, { status: 201 })
  } catch (error: any) {
    console.error('Error adding node rule:', error)
    
return NextResponse.json(
      { error: error.message || 'Failed to add node rule' },
      { status: 500 }
    )
  }
}

export const POST = withAudit({ category: 'firewall', resourceType: 'node', resourceParam: 'node' }, withPublicApiGuard("fw-node-rule-create", postHandler))
