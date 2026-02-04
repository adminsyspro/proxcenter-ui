// src/app/api/v1/firewall/vms/[connectionId]/[node]/[vmType]/[vmid]/route.ts
import { NextRequest, NextResponse } from 'next/server'

import { getOrchestratorClient } from '@/lib/orchestrator/client'

type RouteContext = {
  params: Promise<{ connectionId: string; node: string; vmType: string; vmid: string }>
}

// GET - Récupère options ou règles firewall d'une VM/CT
// ?type=options ou ?type=rules
export async function GET(req: NextRequest, ctx: RouteContext) {
  try {
    const { connectionId, node, vmType, vmid } = await ctx.params
    const url = new URL(req.url)
    const type = url.searchParams.get('type') || 'options'
    
    const orchestrator = getOrchestratorClient()

    const endpoint = type === 'rules' 
      ? `/firewall/vms/${connectionId}/${node}/${vmType}/${vmid}/rules`
      : `/firewall/vms/${connectionId}/${node}/${vmType}/${vmid}/options`
    
    const response = await orchestrator.get(endpoint)

    
return NextResponse.json(response.data)
  } catch (e: any) {
    console.error("[firewall/vms] GET error:", e)
    
return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

// POST - Ajoute une règle firewall
export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const { connectionId, node, vmType, vmid } = await ctx.params
    const body = await req.json()
    
    const orchestrator = getOrchestratorClient()

    const response = await orchestrator.post(
      `/firewall/vms/${connectionId}/${node}/${vmType}/${vmid}/rules`,
      body
    )

    
return NextResponse.json(response.data, { status: 201 })
  } catch (e: any) {
    console.error("[firewall/vms] POST error:", e)
    
return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

// PUT - Met à jour les options firewall
export async function PUT(req: NextRequest, ctx: RouteContext) {
  try {
    const { connectionId, node, vmType, vmid } = await ctx.params
    const body = await req.json()
    
    const orchestrator = getOrchestratorClient()

    const response = await orchestrator.put(
      `/firewall/vms/${connectionId}/${node}/${vmType}/${vmid}/options`,
      body
    )

    
return NextResponse.json(response.data)
  } catch (e: any) {
    console.error("[firewall/vms] PUT error:", e)
    
return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
