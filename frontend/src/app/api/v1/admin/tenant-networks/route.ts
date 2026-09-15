import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"

import { authOptions } from "@/lib/auth/config"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { requireProviderTenant } from "@/lib/tenant"
import { audit } from "@/lib/audit"
import { createTenantNetwork, listTenantNetworks } from "@/lib/vdc/tenantNetworks"
import { mapTenantNetworkError } from "@/lib/vdc/httpErrors"

export const runtime = "nodejs"

async function gate(): Promise<Response | null> {
  const providerGate = await requireProviderTenant()
  if (providerGate) return providerGate
  const denied = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)
  return denied ?? null
}

function fail(e: any): NextResponse {
  const { status, message } = mapTenantNetworkError(e)
  return NextResponse.json({ error: message }, { status })
}

// GET /api/v1/admin/tenant-networks?tenantId=xxx
// Stretched tenant networks (#901), every tenant or one.
export async function GET(req: NextRequest) {
  const denied = await gate()
  if (denied) return denied
  try {
    const tenantId = req.nextUrl.searchParams.get("tenantId") || undefined
    return NextResponse.json({ data: await listTenantNetworks(tenantId) })
  } catch (e: any) {
    return fail(e)
  }
}

// POST /api/v1/admin/tenant-networks
// Reserve a tenant-wide VNI and a PVE VNet id; no vDC carries it yet.
export async function POST(req: NextRequest) {
  const denied = await gate()
  if (denied) return denied
  try {
    const session = await getServerSession(authOptions)
    const body = await req.json()
    if (!body?.tenantId || !body?.name) {
      return NextResponse.json({ error: "tenantId and name are required" }, { status: 400 })
    }
    const network = await createTenantNetwork(
      { tenantId: body.tenantId, name: body.name, description: body.description, vni: body.vni, mtu: body.mtu, subnet: body.subnet },
      session?.user?.id ?? null,
    )
    await audit({
      action: "create",
      category: "settings",
      resourceType: "tenant-network",
      resourceId: network.id,
      resourceName: network.name,
      details: { tenantId: network.tenantId, vni: network.vni, mtu: network.mtu, pveName: network.pveName },
      status: "success",
    })
    return NextResponse.json({ data: network }, { status: 201 })
  } catch (e: any) {
    return fail(e)
  }
}
