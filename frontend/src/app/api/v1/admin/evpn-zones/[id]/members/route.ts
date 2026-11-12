import { NextRequest, NextResponse } from "next/server"

import { audit } from "@/lib/audit"
import { withAudit } from "@/lib/audit/withAudit"
import { withPublicApiGuard } from "@/lib/api-tokens/routeGuard"
import { addEvpnZoneMember, removeEvpnZoneMember, resyncEvpnZoneMember } from "@/lib/vdc/evpnZones"
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

// POST /api/v1/admin/evpn-zones/[id]/members
// Extends the zone to one more cluster.
async function handlePost(req: Request, ctx: RouteContext) {
  const g = await gate(ctx)
  if (g instanceof Response) return g
  try {
    const body = await req.json()
    const result = await addEvpnZoneMember(g.id, { connectionId: body?.connectionId, controller: body?.controller })
    await audit({
      action: "update",
      category: "settings",
      resourceType: "evpn-zone",
      resourceId: result.zone.id,
      resourceName: result.zone.name,
      details: { added: body?.connectionId, clusters: result.zone.members.map(m => m.connectionName) },
      status: "success",
    })
    return NextResponse.json({ data: result.zone, applyErrors: result.applyErrors }, { status: 201 })
  } catch (e: any) {
    return evpnFail(e)
  }
}

// PUT /api/v1/admin/evpn-zones/[id]/members
// Resync: recreates a zone that is gone, applies a staged change.
async function handlePut(req: NextRequest, ctx: RouteContext) {
  const g = await gate(ctx)
  if (g instanceof Response) return g
  try {
    const body = await req.json()
    const connectionId = typeof body?.connectionId === "string" ? body.connectionId : ""
    if (!connectionId) return NextResponse.json({ error: "connectionId is required" }, { status: 400 })
    return NextResponse.json({ data: await resyncEvpnZoneMember(g.id, connectionId) })
  } catch (e: any) {
    return evpnFail(e)
  }
}

// DELETE /api/v1/admin/evpn-zones/[id]/members?connectionId=xxx
// Detaches one cluster.
async function handleDelete(req: Request, ctx: RouteContext) {
  const g = await gate(ctx)
  if (g instanceof Response) return g
  try {
    const connectionId = new URL(req.url).searchParams.get("connectionId") || ""
    if (!connectionId) return NextResponse.json({ error: "connectionId is required" }, { status: 400 })
    const result = await removeEvpnZoneMember(g.id, connectionId)
    await audit({
      action: "update",
      category: "settings",
      resourceType: "evpn-zone",
      resourceId: result.zone.id,
      resourceName: result.zone.name,
      details: { removed: connectionId, clusters: result.zone.members.map(m => m.connectionName) },
      status: "success",
    })
    return NextResponse.json({ data: result.zone, applyErrors: result.applyErrors })
  } catch (e: any) {
    return evpnFail(e)
  }
}

export const POST = withAudit({ category: "sdn", resourceType: "evpn_zone", resourceParam: "id" }, withPublicApiGuard("evpn-zone-member-add", handlePost))
export const PUT = withAudit({ category: "sdn", resourceType: "evpn_zone", resourceParam: "id" }, handlePut)
export const DELETE = withAudit({ category: "sdn", resourceType: "evpn_zone", resourceParam: "id" }, withPublicApiGuard("evpn-zone-member-remove", handleDelete))
