export const dynamic = "force-dynamic"
// src/app/api/v1/firewall/microseg/[connectionId]/vm/[node]/[vmType]/[vmid]/isolate/route.ts
import { NextRequest, NextResponse } from 'next/server'

import { getOrchestratorClient } from '@/lib/orchestrator/client'
import { verifyConnectionOwnership } from '@/lib/tenant'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { withPublicApiGuard } from '@/lib/api-tokens/routeGuard'
import type { Principal } from '@/lib/auth/principal'
import { getTenantInfrastructureScope } from '@/lib/tenant/infraScope'

type Params = { connectionId: string; node: string; vmType: string; vmid: string }

// apply_base_sgs may create cluster-level security groups and gateway
// aliases: a vDC tenant token isolates its own guest without it.
async function tokenBaseSgsRefusal(principal: Principal | undefined, body: any): Promise<string | null> {
  if (principal?.kind !== 'token' || !body?.apply_base_sgs) return null
  const infra = await getTenantInfrastructureScope(principal.tenantId, { ignoreVdcContext: true })

  return infra.kind === 'iaas' ? 'Cluster-level object not available to a vDC tenant token' : null
}

// POST - Isolate VM
async function postHandler(
  request: NextRequest,
  { params, principal }: { params: Promise<Params>; principal?: Principal }
) {
  try {
    const { connectionId, node, vmType, vmid } = await params
    const ownershipDenied = await verifyConnectionOwnership(connectionId)
    if (ownershipDenied) return ownershipDenied

    const denied = await checkPermission(PERMISSIONS.NODE_MANAGE, "connection", connectionId)
    if (denied) return denied

    const body = await request.json()

    const tokenRefusal = await tokenBaseSgsRefusal(principal, body)
    if (tokenRefusal) return NextResponse.json({ error: tokenRefusal }, { status: 403 })

    const orchestrator = getOrchestratorClient()

    const response = await orchestrator.post(
      `/firewall/microseg/${connectionId}/vm/${node}/${vmType}/${vmid}/isolate`,
      body
    )

    
return NextResponse.json(response.data)
  } catch (error: any) {
    console.error('Error isolating VM:', error)
    
return NextResponse.json(
      { error: error.message || 'Failed to isolate VM' },
      { status: 500 }
    )
  }
}

export const POST = withPublicApiGuard("fw-vm-isolate", postHandler)
