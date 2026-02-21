import { NextRequest, NextResponse } from 'next/server'

import { getOrchestratorClient } from '@/lib/orchestrator/client'

type RouteContext = {
  params: Promise<{ connectionId: string; node: string; vmType: string; vmid: string }>
}

// PUT - Toggle firewall on all NICs of a VM/CT
export async function PUT(req: NextRequest, ctx: RouteContext) {
  try {
    const { connectionId, node, vmType, vmid } = await ctx.params
    const body = await req.json()

    const orchestrator = getOrchestratorClient()

    const response = await orchestrator.put(
      `/firewall/vms/${connectionId}/${node}/${vmType}/${vmid}/nic-firewall`,
      body
    )

    return NextResponse.json(response.data)
  } catch (e: any) {
    console.error("[firewall/vms/nic-firewall] PUT error:", e)
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
