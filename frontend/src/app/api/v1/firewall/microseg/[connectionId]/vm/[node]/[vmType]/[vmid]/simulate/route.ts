export const dynamic = "force-dynamic"
// src/app/api/v1/firewall/microseg/[connectionId]/vm/[node]/[vmType]/[vmid]/simulate/route.ts
import { NextRequest, NextResponse } from 'next/server'

import { getOrchestratorClient } from '@/lib/orchestrator/client'
import { verifyConnectionOwnership } from '@/lib/tenant'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { getConnectionById } from '@/lib/connections/getConnection'
import { guardSessionGuest } from '@/lib/vdc/guestGuard'
import { tenantGuestVisibility } from '@/lib/vdc/guestScope'
import { resolveCallerInfraScope } from '@/lib/tenant/iaasGuard'

type Params = { connectionId: string; node: string; vmType: string; vmid: string }

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

    // node.view is connection-wide: the guest itself must be inside the vDC.
    const scopeDenied = await guardSessionGuest({ connectionId, conn: () => getConnectionById(connectionId), type: vmType, node, vmid })
    if (scopeDenied) return scopeDenied

    const orchestrator = getOrchestratorClient()

    const response = await orchestrator.get(
      `/firewall/microseg/${connectionId}/vm/${node}/${vmType}/${vmid}/simulate`
    )
    const simulation = response.data as Record<string, unknown> | null

    // affected_vms is drawn from every guest of the cluster: an IaaS tenant
    // sees only the guests of its own vDC in it (503 when that cannot be
    // verified, never an unmasked list).
    const caller = await resolveCallerInfraScope()
    if (caller.ok === false) return caller.response

    if (caller.infra.kind === 'iaas' && simulation && Array.isArray(simulation.affected_vms)) {
      const visibility = await tenantGuestVisibility(caller.tenantId, await getConnectionById(connectionId), connectionId, { infra: caller.infra })

      if (visibility instanceof NextResponse) return visibility
      simulation.affected_vms = simulation.affected_vms.filter((vm: any) => visibility.has(null, vm?.vmid))
    }

    return NextResponse.json(simulation)
  } catch (error: any) {
    console.error('Error simulating isolation:', error)
    
return NextResponse.json(
      { error: error.message || 'Failed to simulate' },
      { status: 500 }
    )
  }
}
