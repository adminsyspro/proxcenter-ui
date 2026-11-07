export const dynamic = "force-dynamic"
// src/app/api/v1/firewall/microseg/[connectionId]/vms/route.ts
import { NextRequest, NextResponse } from 'next/server'

import { getOrchestratorClient } from '@/lib/orchestrator/client'
import { PERMISSIONS } from '@/lib/rbac'
import { guardProviderInfra } from '@/lib/firewall/providerInfraGuard'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ connectionId: string }> }
) {
  try {
    const { connectionId } = await params
    const denied = await guardProviderInfra(connectionId, PERMISSIONS.NODE_VIEW)
    if (denied) return denied

    const searchParams = request.nextUrl.searchParams
    const network = searchParams.get('network') || ''
    
    const orchestrator = getOrchestratorClient()

    const url = network 
      ? `/firewall/microseg/${connectionId}/vms?network=${encodeURIComponent(network)}`
      : `/firewall/microseg/${connectionId}/vms`

    const response = await orchestrator.get(url)

    
return NextResponse.json(response.data)
  } catch (error: any) {
    console.error('Error listing VMs for segmentation:', error)
    
return NextResponse.json(
      { error: error.message || 'Failed to list VMs' },
      { status: 500 }
    )
  }
}
