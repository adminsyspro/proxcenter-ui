export const dynamic = "force-dynamic"
// src/app/api/v1/firewall/aliases/[connectionId]/[name]/route.ts
import { NextRequest, NextResponse } from 'next/server'

import { getOrchestratorClient } from '@/lib/orchestrator/client'
import { orchestratorPath } from '@/lib/orchestrator/path'
import { PERMISSIONS } from '@/lib/rbac'
import { withPublicApiGuard } from '@/lib/api-tokens/routeGuard'
import { getConnectionById } from '@/lib/connections/getConnection'
import { orchestratorOrPve } from '@/lib/firewall/withPveFallback'
import { firewallParamRefusal } from '@/lib/firewall/pathParams'
import * as pveDirect from '@/lib/firewall/pveDirect'
import { withAudit } from '@/lib/audit/withAudit'
import { guardProviderInfra } from '@/lib/firewall/providerInfraGuard'

// PUT /api/v1/firewall/aliases/[connectionId]/[name] - Update alias
async function putHandler(
  request: NextRequest,
  { params }: { params: Promise<{ connectionId: string; name: string }> }
) {
  try {
    const { connectionId, name } = await params
    const denied = await guardProviderInfra(connectionId, PERMISSIONS.NODE_MANAGE)
    if (denied) return denied
    const malformed = firewallParamRefusal({ alias: name })
    if (malformed) return malformed

    const body = await request.json()

    const orchestrator = getOrchestratorClient()
    const updated = await orchestratorOrPve(
      'firewall/aliases',
      () => orchestrator.put(orchestratorPath`/firewall/aliases/${connectionId}/${name}`, body),
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
async function deleteHandler(
  request: NextRequest,
  { params }: { params: Promise<{ connectionId: string; name: string }> }
) {
  try {
    const { connectionId, name } = await params
    const denied = await guardProviderInfra(connectionId, PERMISSIONS.NODE_MANAGE)
    if (denied) return denied
    const malformed = firewallParamRefusal({ alias: name })
    if (malformed) return malformed

    const orchestrator = getOrchestratorClient()

    await orchestratorOrPve(
      'firewall/aliases',
      () => orchestrator.delete(orchestratorPath`/firewall/aliases/${connectionId}/${name}`),
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

export const PUT = withAudit({ category: 'firewall', resourceType: 'alias', resourceParam: 'name' }, withPublicApiGuard("fw-alias-update", putHandler))
export const DELETE = withAudit({ category: 'firewall', resourceType: 'alias', resourceParam: 'name' }, withPublicApiGuard("fw-alias-delete", deleteHandler))
