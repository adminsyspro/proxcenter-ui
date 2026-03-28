export const dynamic = "force-dynamic"
// src/app/api/v1/firewall/microseg/[connectionId]/vm/[node]/[vmType]/[vmid]/route.ts
import { NextRequest, NextResponse } from 'next/server'

import { getOrchestratorClient } from '@/lib/orchestrator/client'
import { verifyConnectionOwnership } from '@/lib/tenant'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'

type Params = { connectionId: string; node: string; vmType: string; vmid: string }

// GET - Get VM segmentation status
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<Params> }
) {
  try {
    const { connectionId, node, vmType, vmid } = await params
    const ownershipDenied = await verifyConnectionOwnership(connectionId)
    if (ownershipDenied) return ownershipDenied

    const denied = await checkPermission(PERMISSIONS.NODE_VIEW, "connection", connectionId)
    if (denied) return denied

    const orchestrator = getOrchestratorClient()
    const response = await orchestrator.get(`/firewall/microseg/${connectionId}/vm/${node}/${vmType}/${vmid}`)

    
return NextResponse.json(response.data)
  } catch (error: any) {
    console.error('Error getting VM segmentation status:', error)
    
return NextResponse.json(
      { error: error.message || 'Failed to get status' },
      { status: 500 }
    )
  }
}
