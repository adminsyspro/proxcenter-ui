import { NextResponse } from "next/server"

import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { requireProviderTenant } from "@/lib/tenant"
import { audit } from "@/lib/audit"
import { deleteTenantNetwork, getTenantNetwork, updateTenantNetwork } from "@/lib/vdc/tenantNetworks"
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

// GET /api/v1/admin/tenant-networks/[id]
export async function GET(_req: Request, ctx: RouteContext) {
  const g = await gate(ctx)
  if (g instanceof Response) return g
  try {
    return NextResponse.json({ data: await getTenantNetwork(g.id) })
  } catch (e: any) {
    return fail(e)
  }
}

// PUT /api/v1/admin/tenant-networks/[id]
// Name, description and, while no vDC carries the network, its MTU.
export async function PUT(req: Request, ctx: RouteContext) {
  const g = await gate(ctx)
  if (g instanceof Response) return g
  try {
    const body = await req.json()
    const network = await updateTenantNetwork(g.id, {
      name: body?.name,
      description: body?.description,
      mtu: body?.mtu,
    })
    await audit({
      action: "update",
      category: "settings",
      resourceType: "tenant-network",
      resourceId: network.id,
      resourceName: network.name,
      details: { tenantId: network.tenantId, vni: network.vni, mtu: network.mtu },
      status: "success",
    })
    return NextResponse.json({ data: network })
  } catch (e: any) {
    return fail(e)
  }
}

// DELETE /api/v1/admin/tenant-networks/[id]
// Only a network no vDC carries; the VNI is released with it.
export async function DELETE(_req: Request, ctx: RouteContext) {
  const g = await gate(ctx)
  if (g instanceof Response) return g
  try {
    const network = await getTenantNetwork(g.id)
    await deleteTenantNetwork(g.id)
    await audit({
      action: "delete",
      category: "settings",
      resourceType: "tenant-network",
      resourceId: network.id,
      resourceName: network.name,
      details: { tenantId: network.tenantId, vni: network.vni },
      status: "success",
    })
    return NextResponse.json({ data: { success: true } })
  } catch (e: any) {
    return fail(e)
  }
}
