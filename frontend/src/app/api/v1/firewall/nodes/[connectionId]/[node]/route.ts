export const dynamic = "force-dynamic"
// src/app/api/v1/firewall/nodes/[connectionId]/[node]/route.ts
import { NextRequest, NextResponse } from 'next/server'

import { getOrchestratorClient } from '@/lib/orchestrator/client'
import { verifyConnectionOwnership } from '@/lib/tenant'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { withPublicApiGuard } from '@/lib/api-tokens/routeGuard'
import { getConnectionById } from '@/lib/connections/getConnection'
import { orchestratorOrPve } from '@/lib/firewall/withPveFallback'
import * as pveDirect from '@/lib/firewall/pveDirect'
import { withAudit } from '@/lib/audit/withAudit'

// GET /api/v1/firewall/nodes/[connectionId]/[node] - Get node options or rules
async function getHandler(
  request: NextRequest,
  { params }: { params: Promise<{ connectionId: string; node: string }> }
) {
  try {
    const { connectionId, node } = await params
    const ownershipDenied = await verifyConnectionOwnership(connectionId)
    if (ownershipDenied) return ownershipDenied

    const denied = await checkPermission(PERMISSIONS.NODE_VIEW, "connection", connectionId)
    if (denied) return denied

    const { searchParams } = new URL(request.url)
    const type = searchParams.get('type') || 'options'

    const orchestrator = getOrchestratorClient()
    const result = await orchestratorOrPve(
      'firewall/nodes',
      () => orchestrator.get(`/firewall/nodes/${connectionId}/${node}/${type}`),
      async () => {
        const conn = await getConnectionById(connectionId)

        return type === 'rules'
          ? pveDirect.getNodeRules(conn, node)
          : pveDirect.getNodeOptions(conn, node)
      },
    )

    return NextResponse.json(result)
  } catch (error: any) {
    console.error('Error fetching node firewall:', error)
    
return NextResponse.json(
      { error: error.message || 'Failed to fetch node firewall' },
      { status: 500 }
    )
  }
}

// PUT /api/v1/firewall/nodes/[connectionId]/[node] - Update node options
async function putHandler(
  request: NextRequest,
  { params }: { params: Promise<{ connectionId: string; node: string }> }
) {
  try {
    const { connectionId, node } = await params
    const ownershipDenied = await verifyConnectionOwnership(connectionId)
    if (ownershipDenied) return ownershipDenied

    const denied = await checkPermission(PERMISSIONS.NODE_MANAGE, "connection", connectionId)
    if (denied) return denied

    const body = await request.json()

    const orchestrator = getOrchestratorClient()
    const result = await orchestratorOrPve(
      'firewall/nodes',
      () => orchestrator.put(`/firewall/nodes/${connectionId}/${node}/options`, body),
      async () => pveDirect.updateNodeOptions(await getConnectionById(connectionId), node, body),
    )

    return NextResponse.json(result)
  } catch (error: any) {
    console.error('Error updating node options:', error)
    
return NextResponse.json(
      { error: error.message || 'Failed to update node options' },
      { status: 500 }
    )
  }
}

// POST /api/v1/firewall/nodes/[connectionId]/[node] - Add node rule
async function postHandler(
  request: NextRequest,
  { params }: { params: Promise<{ connectionId: string; node: string }> }
) {
  try {
    const { connectionId, node } = await params
    const ownershipDenied = await verifyConnectionOwnership(connectionId)
    if (ownershipDenied) return ownershipDenied

    const denied = await checkPermission(PERMISSIONS.NODE_MANAGE, "connection", connectionId)
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

export const GET = withPublicApiGuard("fw-node-get", getHandler)
export const PUT = withAudit({ category: 'firewall', resourceType: 'node', resourceParam: 'node' }, withPublicApiGuard("fw-node-options-update", putHandler))
export const POST = withAudit({ category: 'firewall', resourceType: 'node', resourceParam: 'node' }, withPublicApiGuard("fw-node-rule-add", postHandler))
