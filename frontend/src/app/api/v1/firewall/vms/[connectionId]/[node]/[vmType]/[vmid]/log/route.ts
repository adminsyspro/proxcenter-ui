export const dynamic = "force-dynamic"
import { NextRequest, NextResponse } from 'next/server'

import { getOrchestratorClient } from '@/lib/orchestrator/client'
import { verifyConnectionOwnership } from '@/lib/tenant'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'

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
    const response = await orchestrator.get(
      `/firewall/vms/${connectionId}/${node}/${vmType}/${vmid}/log?limit=${limit}`
    )

    return NextResponse.json(response.data)
  } catch (e: any) {
    console.error("[firewall/vms/log] GET error:", e)
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
