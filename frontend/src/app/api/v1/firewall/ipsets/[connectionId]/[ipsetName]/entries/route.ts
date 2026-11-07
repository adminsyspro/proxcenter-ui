export const dynamic = "force-dynamic"
// src/app/api/v1/firewall/ipsets/[connectionId]/[ipsetName]/entries/route.ts
import { NextRequest, NextResponse } from 'next/server'

import { getOrchestratorClient } from '@/lib/orchestrator/client'
import { PERMISSIONS } from '@/lib/rbac'
import { withPublicApiGuard } from '@/lib/api-tokens/routeGuard'
import { getConnectionById } from '@/lib/connections/getConnection'
import { orchestratorOrPve } from '@/lib/firewall/withPveFallback'
import * as pveDirect from '@/lib/firewall/pveDirect'
import { withAudit } from '@/lib/audit/withAudit'
import { guardProviderInfra } from '@/lib/firewall/providerInfraGuard'

// POST /api/v1/firewall/ipsets/[connectionId]/[ipsetName]/entries - Add entry
async function postHandler(
  request: NextRequest,
  { params }: { params: Promise<{ connectionId: string; ipsetName: string }> }
) {
  try {
    const { connectionId, ipsetName } = await params
    const denied = await guardProviderInfra(connectionId, PERMISSIONS.NODE_MANAGE)
    if (denied) return denied

    const body = await request.json()

    const orchestrator = getOrchestratorClient()
    const created = await orchestratorOrPve(
      'firewall/ipsets/entries',
      () => orchestrator.post(`/firewall/ipsets/${connectionId}/${ipsetName}/entries`, body),
      async () => pveDirect.addIPSetEntry(await getConnectionById(connectionId), ipsetName, body),
    )

    return NextResponse.json(created, { status: 201 })
  } catch (error: any) {
    console.error('Error adding IP set entry:', error)
    
return NextResponse.json(
      { error: error.message || 'Failed to add entry' },
      { status: 500 }
    )
  }
}

export const POST = withAudit({ category: 'firewall', resourceType: 'ipset', resourceParam: 'ipsetName' }, withPublicApiGuard("fw-ipset-entry-create", postHandler))
