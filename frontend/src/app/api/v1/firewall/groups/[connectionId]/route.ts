export const dynamic = "force-dynamic"
// src/app/api/v1/firewall/groups/[connectionId]/route.ts
import { NextRequest, NextResponse } from 'next/server'

import { getOrchestratorClient } from '@/lib/orchestrator/client'
import { verifyConnectionOwnership } from '@/lib/tenant'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'

// GET /api/v1/firewall/groups/[connectionId] - Get all security groups
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

    const orchestrator = getOrchestratorClient()
    const response = await orchestrator.get(`/firewall/groups/${connectionId}`)

    return NextResponse.json(response.data)
  } catch (error: any) {
    console.error('Error fetching security groups:', error)
    
return NextResponse.json(
      { error: error.message || 'Failed to fetch security groups' },
      { status: 500 }
    )
  }
}

// POST /api/v1/firewall/groups/[connectionId] - Create security group
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
    const response = await orchestrator.post(`/firewall/groups/${connectionId}`, body)

    return NextResponse.json(response.data, { status: 201 })
  } catch (error: any) {
    console.error('Error creating security group:', error)
    
return NextResponse.json(
      { error: error.message || 'Failed to create security group' },
      { status: 500 }
    )
  }
}
