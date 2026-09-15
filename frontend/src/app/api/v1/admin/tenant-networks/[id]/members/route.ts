import { NextRequest, NextResponse } from "next/server"

import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { requireProviderTenant } from "@/lib/tenant"
import { audit } from "@/lib/audit"
import { addMember, removeMember } from "@/lib/vdc/tenantNetworkMembers"
import { getTenantNetwork } from "@/lib/vdc/tenantNetworks"
import { mapTenantNetworkError } from "@/lib/vdc/httpErrors"

export const runtime = "nodejs"

type RouteContext = { params: Promise<{ id: string }> | { id: string } }

async function gate(ctx: RouteContext): Promise<{ id: string } | Response> {
  const params = await Promise.resolve(ctx.params)
  const id = (params as any)?.id
  if (!id) return NextResponse.json({ error: "Missing tenant network ID" }, { status: 400 })
  const providerGate = await requireProviderTenant()
  if (providerGate) return providerGate
  const denied = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)
  if (denied) return denied
  return { id }
}

function fail(e: any): NextResponse {
  const { status, message } = mapTenantNetworkError(e)
  return NextResponse.json({ error: message }, { status })
}

// POST /api/v1/admin/tenant-networks/[id]/members  { vdcId }
// Make a vDC carry the network: local VNet with the network's VNI, then the
// peers of every member zone (#901).
export async function POST(req: NextRequest, ctx: RouteContext) {
  const g = await gate(ctx)
  if (g instanceof Response) return g
  try {
    const body = await req.json()
    if (!body?.vdcId) return NextResponse.json({ error: "vdcId is required" }, { status: 400 })
    const result = await addMember(g.id, String(body.vdcId))
    const network = await getTenantNetwork(g.id)
    await audit({
      action: "update",
      category: "settings",
      resourceType: "tenant-network",
      resourceId: g.id,
      resourceName: network.name,
      details: { operation: "add-member", vdcId: result.vdcId, pveName: result.pveName, vni: network.vni, zoneSync: result.zoneSync },
      status: "success",
    })
    return NextResponse.json({ data: { ...result, network } }, { status: 201 })
  } catch (e: any) {
    return fail(e)
  }
}

// DELETE /api/v1/admin/tenant-networks/[id]/members?vdcId=xxx
// Stop a vDC carrying the network; refused while a guest NIC still uses it.
export async function DELETE(req: NextRequest, ctx: RouteContext) {
  const g = await gate(ctx)
  if (g instanceof Response) return g
  try {
    const vdcId = req.nextUrl.searchParams.get("vdcId")
    if (!vdcId) return NextResponse.json({ error: "vdcId is required" }, { status: 400 })
    const result = await removeMember(g.id, vdcId)
    const network = await getTenantNetwork(g.id)
    await audit({
      action: "update",
      category: "settings",
      resourceType: "tenant-network",
      resourceId: g.id,
      resourceName: network.name,
      details: { operation: "remove-member", vdcId, zoneSync: result.zoneSync },
      status: "success",
    })
    return NextResponse.json({ data: { ...result, network } })
  } catch (e: any) {
    return fail(e)
  }
}
