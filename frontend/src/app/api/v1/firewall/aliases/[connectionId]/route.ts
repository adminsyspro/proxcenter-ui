export const dynamic = "force-dynamic"
// src/app/api/v1/firewall/aliases/[connectionId]/route.ts
import { NextRequest, NextResponse } from 'next/server'

import { getOrchestratorClient } from '@/lib/orchestrator/client'
import { verifyConnectionOwnership } from '@/lib/tenant'
import { resolveCallerInfraScope } from '@/lib/tenant/iaasGuard'
import { iaasFirewallNamesView } from '@/lib/connections/iaasView'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { withPublicApiGuard } from '@/lib/api-tokens/routeGuard'
import { getConnectionById } from '@/lib/connections/getConnection'
import { orchestratorOrPve } from '@/lib/firewall/withPveFallback'
import * as pveDirect from '@/lib/firewall/pveDirect'
import { withAudit } from '@/lib/audit/withAudit'
import { guardProviderInfra } from '@/lib/firewall/providerInfraGuard'

// GET /api/v1/firewall/aliases/[connectionId] - Get all aliases
async function getHandler(
  request: NextRequest,
  { params }: { params: Promise<{ connectionId: string }> }
) {
  try {
    const { connectionId } = await params
    // An IaaS tenant picks these by name in its guests' firewall rules and
    // reads nothing else of the provider's datacenter firewall (lib/connections/iaasView).
    const caller = await resolveCallerInfraScope()
    if (caller.ok === false) return caller.response

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

    return NextResponse.json(caller.infra.kind === 'iaas' ? iaasFirewallNamesView(aliases, 'name') : aliases)
  } catch (error: any) {
    console.error('Error fetching aliases:', error)
    
return NextResponse.json(
      { error: error.message || 'Failed to fetch aliases' },
      { status: 500 }
    )
  }
}

// POST /api/v1/firewall/aliases/[connectionId] - Create alias
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

export const GET = withPublicApiGuard("fw-aliases-list", getHandler)
export const POST = withAudit({ category: 'firewall', resourceType: 'alias', resourceParam: 'connectionId' }, withPublicApiGuard("fw-alias-create", postHandler))
