import { NextResponse } from "next/server"

import { audit } from "@/lib/audit"
import { withAudit } from "@/lib/audit/withAudit"
import { deleteEvpnZone, getEvpnZone, getEvpnZoneStatus, updateEvpnZone } from "@/lib/vdc/evpnZones"
import { evpnFail, evpnGate } from "@/lib/vdc/evpnRouteGate"

export const runtime = "nodejs"

type RouteContext = { params: Promise<{ id: string }> | { id: string } }

async function gate(ctx: RouteContext): Promise<{ id: string } | Response> {
  const params = await Promise.resolve(ctx.params)
  const id = (params as any)?.id
  if (!id) return NextResponse.json({ error: "Missing EVPN zone ID" }, { status: 400 })
  const denied = await evpnGate()
  if (denied) return denied
  return { id }
}

// GET /api/v1/admin/evpn-zones/[id]
// The zone and how each member cluster runs it.
export async function GET(_req: Request, ctx: RouteContext) {
  const g = await gate(ctx)
  if (g instanceof Response) return g
  try {
    const [zone, status] = await Promise.all([getEvpnZone(g.id), getEvpnZoneStatus(g.id)])
    return NextResponse.json({ data: { ...zone, status } })
  } catch (e: any) {
    return evpnFail(e)
  }
}

// PUT /api/v1/admin/evpn-zones/[id]
// Name, description and VNI range.
async function handlePut(req: Request, ctx: RouteContext) {
  const g = await gate(ctx)
  if (g instanceof Response) return g
  try {
    const body = await req.json()
    const zone = await updateEvpnZone(g.id, {
      name: body?.name,
      description: body?.description,
      vniStart: body?.vniStart,
      vniEnd: body?.vniEnd,
    })
    await audit({
      action: "update",
      category: "settings",
      resourceType: "evpn-zone",
      resourceId: zone.id,
      resourceName: zone.name,
      details: { vniRange: `${zone.vniStart}-${zone.vniEnd}` },
      status: "success",
    })
    return NextResponse.json({ data: zone })
  } catch (e: any) {
    return evpnFail(e)
  }
}

// DELETE /api/v1/admin/evpn-zones/[id]
// Removes the zone from every cluster where ProxCenter created it.
async function handleDelete(_req: Request, ctx: RouteContext) {
  const g = await gate(ctx)
  if (g instanceof Response) return g
  try {
    const zone = await getEvpnZone(g.id)
    const applyErrors = await deleteEvpnZone(g.id)
    await audit({
      action: "delete",
      category: "settings",
      resourceType: "evpn-zone",
      resourceId: zone.id,
      resourceName: zone.name,
      details: { zoneName: zone.zoneName, clusters: zone.members.map(m => m.connectionName), applyErrors: applyErrors.length },
      status: "success",
    })
    return NextResponse.json({ data: { success: true }, applyErrors })
  } catch (e: any) {
    return evpnFail(e)
  }
}

export const PUT = withAudit({ category: "sdn", resourceType: "evpn_zone", resourceParam: "id" }, handlePut)
export const DELETE = withAudit({ category: "sdn", resourceType: "evpn_zone", resourceParam: "id" }, handleDelete)
