export const dynamic = "force-dynamic"
// src/app/api/v1/firewall/vms/[connectionId]/[node]/[vmType]/[vmid]/rules/[pos]/route.ts
import { NextRequest, NextResponse } from 'next/server'

import { getOrchestratorClient } from '@/lib/orchestrator/client'
import { verifyConnectionOwnership } from '@/lib/tenant'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { getConnectionById } from '@/lib/connections/getConnection'
import { orchestratorOrPve } from '@/lib/firewall/withPveFallback'
import * as pveDirect from '@/lib/firewall/pveDirect'

type RouteContext = {
  params: Promise<{ connectionId: string; node: string; vmType: string; vmid: string; pos: string }>
}

// PUT - Update a VM firewall rule
export async function PUT(req: NextRequest, ctx: RouteContext) {
  try {
    const { connectionId, node, vmType, vmid, pos } = await ctx.params
    const ownershipDenied = await verifyConnectionOwnership(connectionId)
    if (ownershipDenied) return ownershipDenied

    const denied = await checkPermission(PERMISSIONS.NODE_MANAGE, "connection", connectionId)
    if (denied) return denied

    const body = await req.json()
    
    const orchestrator = getOrchestratorClient()

    const result = await orchestratorOrPve(
      'firewall/vms/rules',
      () => orchestrator.put(`/firewall/vms/${connectionId}/${node}/${vmType}/${vmid}/rules/${pos}`, body),
      async () => pveDirect.updateVMRule(await getConnectionById(connectionId), node, vmType, vmid, pos, body),
    )

    return NextResponse.json(result)
  } catch (e: any) {
    console.error("[firewall/vms/rules] PUT error:", e)
    
return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

// DELETE - Delete a VM firewall rule
export async function DELETE(req: NextRequest, ctx: RouteContext) {
  try {
    const { connectionId, node, vmType, vmid, pos } = await ctx.params
    const ownershipDenied = await verifyConnectionOwnership(connectionId)
    if (ownershipDenied) return ownershipDenied

    const denied = await checkPermission(PERMISSIONS.NODE_MANAGE, "connection", connectionId)
    if (denied) return denied

    const orchestrator = getOrchestratorClient()

    const result = await orchestratorOrPve(
      'firewall/vms/rules',
      () => orchestrator.delete(`/firewall/vms/${connectionId}/${node}/${vmType}/${vmid}/rules/${pos}`),
      async () => pveDirect.deleteVMRule(await getConnectionById(connectionId), node, vmType, vmid, pos),
    )

    return NextResponse.json(result)
  } catch (e: any) {
    console.error("[firewall/vms/rules] DELETE error:", e)
    
return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
