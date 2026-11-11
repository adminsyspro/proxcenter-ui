export const dynamic = "force-dynamic"
// src/app/api/v1/firewall/groups/[connectionId]/[groupName]/rules/[pos]/route.ts
import { NextRequest, NextResponse } from 'next/server'

import { getOrchestratorClient } from '@/lib/orchestrator/client'
import { orchestratorPath } from '@/lib/orchestrator/path'
import { getConnectionById } from '@/lib/connections/getConnection'
import * as pveDirect from '@/lib/firewall/pveDirect'
import { orchestratorOrPve } from '@/lib/firewall/withPveFallback'
import { firewallParamRefusal } from '@/lib/firewall/pathParams'
import { PERMISSIONS } from '@/lib/rbac'
import { withPublicApiGuard } from '@/lib/api-tokens/routeGuard'
import { withAudit } from '@/lib/audit/withAudit'
import { guardProviderInfra } from '@/lib/firewall/providerInfraGuard'

// PUT /api/v1/firewall/groups/[connectionId]/[groupName]/rules/[pos] - Update rule
async function putHandler(
  request: NextRequest,
  { params }: { params: Promise<{ connectionId: string; groupName: string; pos: string }> }
) {
  try {
    const { connectionId, groupName, pos } = await params
    const denied = await guardProviderInfra(connectionId, PERMISSIONS.NODE_MANAGE)
    if (denied) return denied
    const malformed = firewallParamRefusal({ group: groupName, pos })
    if (malformed) return malformed

    const body = await request.json()

    const orchestrator = getOrchestratorClient()

    // Community has no orchestrator: update the rule straight on PVE (#616).
    await orchestratorOrPve(
      'firewall/groups/rules',
      () => orchestrator.put(orchestratorPath`/firewall/groups/${connectionId}/${groupName}/rules/${pos}`, body),
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
async function deleteHandler(
  request: NextRequest,
  { params }: { params: Promise<{ connectionId: string; groupName: string; pos: string }> }
) {
  try {
    const { connectionId, groupName, pos } = await params
    const denied = await guardProviderInfra(connectionId, PERMISSIONS.NODE_MANAGE)
    if (denied) return denied
    const malformed = firewallParamRefusal({ group: groupName, pos })
    if (malformed) return malformed

    const orchestrator = getOrchestratorClient()

    await orchestratorOrPve(
      'firewall/groups/rules',
      () => orchestrator.delete(orchestratorPath`/firewall/groups/${connectionId}/${groupName}/rules/${pos}`),
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

export const PUT = withAudit({ category: 'firewall', resourceType: 'rule', resourceParam: 'pos' }, withPublicApiGuard("fw-group-rule-update", putHandler))
export const DELETE = withAudit({ category: 'firewall', resourceType: 'rule', resourceParam: 'pos' }, withPublicApiGuard("fw-group-rule-delete", deleteHandler))
