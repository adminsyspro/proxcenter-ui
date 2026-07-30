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

export async function GET(req: NextRequest, ctx: RouteContext) {
  try {
    const { connectionId, node, vmType, vmid } = await ctx.params
    const ownershipDenied = await verifyConnectionOwnership(connectionId)
    if (ownershipDenied) return ownershipDenied

    const denied = await checkPermission(PERMISSIONS.NODE_VIEW, "connection", connectionId)
    if (denied) return denied

    const url = new URL(req.url)
    const limit = url.searchParams.get('limit') || '50'

    const orchestrator = getOrchestratorClient()
    const result = await orchestratorOrPve(
      'firewall/vms/log',
      () => orchestrator.get(`/firewall/vms/${connectionId}/${node}/${vmType}/${vmid}/log?limit=${limit}`),
      async () => pveDirect.getVMFirewallLog(await getConnectionById(connectionId), node, vmType, vmid, Number(limit)),
    )

    return NextResponse.json(result)
  } catch (e: any) {
    console.error("[firewall/vms/log] GET error:", e)
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
