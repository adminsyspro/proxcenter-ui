export const dynamic = "force-dynamic"
// src/app/api/v1/firewall/cluster/[connectionId]/rules/route.ts
import { NextRequest, NextResponse } from 'next/server'

import { getOrchestratorClient } from '@/lib/orchestrator/client'
import { PERMISSIONS } from '@/lib/rbac'
import { withPublicApiGuard } from '@/lib/api-tokens/routeGuard'
import { orchestratorOrPve } from '@/lib/firewall/withPveFallback'
import * as pveDirect from '@/lib/firewall/pveDirect'
import { getConnectionById } from '@/lib/connections/getConnection'
import { withAudit } from '@/lib/audit/withAudit'
import { guardProviderInfra } from '@/lib/firewall/providerInfraGuard'

// POST /api/v1/firewall/cluster/[connectionId]/rules - Add cluster rule
async function postHandler(
  request: NextRequest,
  { params }: { params: Promise<{ connectionId: string }> }
) {
  try {
    const { connectionId } = await params
    const denied = await guardProviderInfra(connectionId, PERMISSIONS.NODE_MANAGE)
    if (denied) return denied

    const body = await request.json()

    const orchestrator = getOrchestratorClient()
    const result = await orchestratorOrPve(
      'firewall/cluster/rules',
      () => orchestrator.post(`/firewall/cluster/${connectionId}/rules`, body),
      async () => pveDirect.addClusterRule(await getConnectionById(connectionId), body),
    )

    return NextResponse.json(result, { status: 201 })
  } catch (error: any) {
    console.error('Error adding cluster rule:', error)
    
return NextResponse.json(
      { error: error.message || 'Failed to add cluster rule' },
      { status: 500 }
    )
  }
}

export const POST = withAudit({ category: 'firewall', resourceType: 'cluster', resourceParam: 'connectionId' }, withPublicApiGuard("fw-cluster-rule-create", postHandler))
