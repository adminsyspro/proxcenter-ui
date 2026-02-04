// src/app/api/v1/firewall/vms/[connectionId]/[node]/[vmType]/[vmid]/rules/[pos]/route.ts
import { NextRequest, NextResponse } from 'next/server'

import { getOrchestratorClient } from '@/lib/orchestrator/client'

type RouteContext = {
  params: Promise<{ connectionId: string; node: string; vmType: string; vmid: string; pos: string }>
}

// PUT - Update a VM firewall rule
export async function PUT(req: NextRequest, ctx: RouteContext) {
  try {
    const { connectionId, node, vmType, vmid, pos } = await ctx.params
    const body = await req.json()
    
    const orchestrator = getOrchestratorClient()

    const response = await orchestrator.put(
      `/firewall/vms/${connectionId}/${node}/${vmType}/${vmid}/rules/${pos}`,
      body
    )
    
    return NextResponse.json(response.data)
  } catch (e: any) {
    console.error("[firewall/vms/rules] PUT error:", e)
    
return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

// DELETE - Delete a VM firewall rule
export async function DELETE(req: NextRequest, ctx: RouteContext) {
  try {
    const { connectionId, node, vmType, vmid, pos } = await ctx.params
    
    const orchestrator = getOrchestratorClient()

    const response = await orchestrator.delete(
      `/firewall/vms/${connectionId}/${node}/${vmType}/${vmid}/rules/${pos}`
    )
    
    return NextResponse.json(response.data)
  } catch (e: any) {
    console.error("[firewall/vms/rules] DELETE error:", e)
    
return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
