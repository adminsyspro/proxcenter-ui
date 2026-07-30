export const dynamic = "force-dynamic"
// src/app/api/v1/firewall/cluster/[connectionId]/route.ts
import { NextRequest, NextResponse } from 'next/server'

import { getOrchestratorClient } from '@/lib/orchestrator/client'
import { verifyConnectionOwnership } from '@/lib/tenant'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { orchestratorOrPve } from '@/lib/firewall/withPveFallback'
import * as pveDirect from '@/lib/firewall/pveDirect'
import { getConnectionById } from '@/lib/connections/getConnection'

// GET /api/v1/firewall/cluster/[connectionId] - Get cluster options or rules
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

    const { searchParams } = new URL(request.url)
    const type = searchParams.get('type') || 'options'

    const orchestrator = getOrchestratorClient()
    const result = await orchestratorOrPve(
      'firewall/cluster',
      () => orchestrator.get(`/firewall/cluster/${connectionId}/${type}`),
      async () => {
        const conn = await getConnectionById(connectionId)

        // Cluster level exposes exactly these two sub-resources; anything else
        // reads the options, like the orchestrator's own default.
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
export async function PUT(
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
    const result = await orchestratorOrPve(
      'firewall/cluster',
      () => orchestrator.put(`/firewall/cluster/${connectionId}/options`, body),
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
    const result = await orchestratorOrPve(
      'firewall/cluster',
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
