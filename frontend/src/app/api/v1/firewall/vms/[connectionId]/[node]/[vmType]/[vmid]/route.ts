export const dynamic = "force-dynamic"
// src/app/api/v1/firewall/vms/[connectionId]/[node]/[vmType]/[vmid]/route.ts
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

// GET - Récupère options ou règles firewall d'une VM/CT
// ?type=options ou ?type=rules
export async function GET(req: NextRequest, ctx: RouteContext) {
  try {
    const { connectionId, node, vmType, vmid } = await ctx.params
    const ownershipDenied = await verifyConnectionOwnership(connectionId)
    if (ownershipDenied) return ownershipDenied

    const denied = await checkPermission(PERMISSIONS.NODE_VIEW, "connection", connectionId)
    if (denied) return denied

    const url = new URL(req.url)
    const type = url.searchParams.get('type') || 'options'
    
    const orchestrator = getOrchestratorClient()

    const endpoint = type === 'rules' 
      ? `/firewall/vms/${connectionId}/${node}/${vmType}/${vmid}/rules`
      : `/firewall/vms/${connectionId}/${node}/${vmType}/${vmid}/options`
    
    const result = await orchestratorOrPve(
      'firewall/vms',
      () => orchestrator.get(endpoint),
      async () => {
        const conn = await getConnectionById(connectionId)

        return type === 'rules'
          ? pveDirect.getVMRules(conn, node, vmType, vmid)
          : pveDirect.getVMOptions(conn, node, vmType, vmid)
      },
    )

    return NextResponse.json(result)
  } catch (e: any) {
    console.error("[firewall/vms] GET error:", e)
    
return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

// POST - Ajoute une règle firewall
export async function POST(req: NextRequest, ctx: RouteContext) {
  try {
    const { connectionId, node, vmType, vmid } = await ctx.params
    const ownershipDenied = await verifyConnectionOwnership(connectionId)
    if (ownershipDenied) return ownershipDenied

    const denied = await checkPermission(PERMISSIONS.NODE_MANAGE, "connection", connectionId)
    if (denied) return denied

    const body = await req.json()

    const orchestrator = getOrchestratorClient()

    const result = await orchestratorOrPve(
      'firewall/vms',
      () => orchestrator.post(`/firewall/vms/${connectionId}/${node}/${vmType}/${vmid}/rules`, body),
      async () => pveDirect.addVMRule(await getConnectionById(connectionId), node, vmType, vmid, body),
    )

    return NextResponse.json(result, { status: 201 })
  } catch (e: any) {
    console.error("[firewall/vms] POST error:", e)
    
return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

// PUT - Met à jour les options firewall
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
      'firewall/vms',
      () => orchestrator.put(`/firewall/vms/${connectionId}/${node}/${vmType}/${vmid}/options`, body),
      async () => pveDirect.updateVMOptions(await getConnectionById(connectionId), node, vmType, vmid, body),
    )

    return NextResponse.json(result)
  } catch (e: any) {
    console.error("[firewall/vms] PUT error:", e)
    
return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
