export const dynamic = "force-dynamic"
// src/app/api/v1/firewall/cluster/[connectionId]/route.ts
import { NextRequest, NextResponse } from 'next/server'

import { getOrchestratorClient } from '@/lib/orchestrator/client'
import { orchestratorPath } from '@/lib/orchestrator/path'
import { PERMISSIONS } from '@/lib/rbac'
import { withPublicApiGuard } from '@/lib/api-tokens/routeGuard'
import { orchestratorOrPve } from '@/lib/firewall/withPveFallback'
import { firewallResourceType, invalidResourceType } from '@/lib/firewall/pathParams'
import * as pveDirect from '@/lib/firewall/pveDirect'
import { getConnectionById } from '@/lib/connections/getConnection'
import { withAudit } from '@/lib/audit/withAudit'
import { guardProviderInfra } from '@/lib/firewall/providerInfraGuard'

// GET /api/v1/firewall/cluster/[connectionId] - Get cluster options or rules
async function getHandler(
  request: NextRequest,
  { params }: { params: Promise<{ connectionId: string }> }
) {
  try {
    const { connectionId } = await params
    const denied = await guardProviderInfra(connectionId, PERMISSIONS.NODE_VIEW)
    if (denied) return denied

    const { searchParams } = new URL(request.url)
    const type = firewallResourceType(searchParams.get('type'))
    if (!type) return invalidResourceType()

    const orchestrator = getOrchestratorClient()
    const result = await orchestratorOrPve(
      'firewall/cluster',
      () => orchestrator.get(orchestratorPath`/firewall/cluster/${connectionId}/${type}`),
      async () => {
        const conn = await getConnectionById(connectionId)

        return type === 'rules' ? await pveDirect.getClusterRules(conn) : await pveDirect.getClusterOptions(conn)
      },
    )

    return NextResponse.json(result)
  } catch (error: any) {
    console.error('Error fetching cluster firewall:', error)
    
return NextResponse.json(
      { error: error.message || 'Failed to fetch cluster firewall' },
      { status: 500 }
    )
  }
}

// PUT /api/v1/firewall/cluster/[connectionId] - Update cluster options
async function putHandler(
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
      'firewall/cluster',
      () => orchestrator.put(orchestratorPath`/firewall/cluster/${connectionId}/options`, body),
      async () => pveDirect.updateClusterOptions(await getConnectionById(connectionId), body),
    )

    return NextResponse.json(result)
  } catch (error: any) {
    console.error('Error updating cluster options:', error)
    
return NextResponse.json(
      { error: error.message || 'Failed to update cluster options' },
      { status: 500 }
    )
  }
}

// POST /api/v1/firewall/cluster/[connectionId] - Add cluster rule
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
      'firewall/cluster',
      () => orchestrator.post(orchestratorPath`/firewall/cluster/${connectionId}/rules`, body),
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

export const GET = withPublicApiGuard("fw-cluster-get", getHandler)
export const PUT = withAudit({ category: 'firewall', resourceType: 'cluster', resourceParam: 'connectionId' }, withPublicApiGuard("fw-cluster-options-update", putHandler))
export const POST = withAudit({ category: 'firewall', resourceType: 'cluster', resourceParam: 'connectionId' }, withPublicApiGuard("fw-cluster-rule-add", postHandler))
