export const dynamic = "force-dynamic"
import { NextRequest, NextResponse } from 'next/server'

import { getOrchestratorClient } from '@/lib/orchestrator/client'
import { verifyConnectionOwnership } from '@/lib/tenant'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { getConnectionById } from '@/lib/connections/getConnection'
import { orchestratorOrPve } from '@/lib/firewall/withPveFallback'
import * as pveDirect from '@/lib/firewall/pveDirect'

type RouteContext = {
  params: Promise<{ connectionId: string; node: string; vmType: string; vmid: string }>
}

// PUT - Toggle firewall on all NICs of a VM/CT
export async function PUT(req: NextRequest, ctx: RouteContext) {
  try {
    const { connectionId, node, vmType, vmid } = await ctx.params
    const ownershipDenied = await verifyConnectionOwnership(connectionId)
    if (ownershipDenied) return ownershipDenied

    const denied = await checkPermission(PERMISSIONS.NODE_MANAGE, "connection", connectionId)
    if (denied) return denied

    const body = await req.json()

    const orchestrator = getOrchestratorClient()

    const result = await orchestratorOrPve(
      'firewall/vms/nic-firewall',
      () => orchestrator.put(`/firewall/vms/${connectionId}/${node}/${vmType}/${vmid}/nic-firewall`, body),
      // Second level of the guest firewall: rewrites firewall=0/1 on every NIC
      async () => pveDirect.toggleVMNICFirewall(await getConnectionById(connectionId), node, vmType, vmid, body.enable),
    )

    return NextResponse.json(result)
  } catch (e: any) {
    console.error("[firewall/vms/nic-firewall] PUT error:", e)
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
