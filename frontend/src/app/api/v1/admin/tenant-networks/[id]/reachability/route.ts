import { NextResponse } from "next/server"

import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { requireProviderTenant } from "@/lib/tenant"
import { testNetworkReachability } from "@/lib/vdc/tenantNetworkReachability"
import { mapTenantNetworkError } from "@/lib/vdc/httpErrors"

export const runtime = "nodejs"

type RouteContext = { params: Promise<{ id: string }> | { id: string } }

// POST /api/v1/admin/tenant-networks/[id]/reachability
// Every node of each member vDC pings the transport peers of the other members
// over SSH (#901). Read-only diagnostic: nothing is written anywhere.
export async function POST(_req: Request, ctx: RouteContext) {
  const params = await Promise.resolve(ctx.params)
  const id = (params as any)?.id
  if (!id) return NextResponse.json({ error: "Missing tenant network ID" }, { status: 400 })
  const providerGate = await requireProviderTenant()
  if (providerGate) return providerGate
  const denied = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)
  if (denied) return denied
  try {
    return NextResponse.json({ data: { results: await testNetworkReachability(id) } })
  } catch (e: any) {
    const { status, message } = mapTenantNetworkError(e)
    return NextResponse.json({ error: message }, { status })
  }
}
