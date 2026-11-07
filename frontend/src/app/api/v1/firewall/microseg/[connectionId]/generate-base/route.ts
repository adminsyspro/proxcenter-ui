export const dynamic = "force-dynamic"
// src/app/api/v1/firewall/microseg/[connectionId]/generate-base/route.ts
import { NextRequest, NextResponse } from 'next/server'

import { getOrchestratorClient } from '@/lib/orchestrator/client'
import { PERMISSIONS } from '@/lib/rbac'
import { withPublicApiGuard } from '@/lib/api-tokens/routeGuard'
import { withAudit } from '@/lib/audit/withAudit'
import { guardProviderInfra } from '@/lib/firewall/providerInfraGuard'

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
    const response = await orchestrator.post(`/firewall/microseg/${connectionId}/generate-base`, body)

    
return NextResponse.json(response.data)
  } catch (error: any) {
    console.error('Error generating base SGs:', error)
    
return NextResponse.json(
      { error: error.message || 'Failed to generate' },
      { status: 500 }
    )
  }
}

export const POST = withAudit({ category: 'firewall', resourceType: 'microseg', resourceParam: 'connectionId', action: 'apply' }, withPublicApiGuard("fw-microseg-base-generate", postHandler))
