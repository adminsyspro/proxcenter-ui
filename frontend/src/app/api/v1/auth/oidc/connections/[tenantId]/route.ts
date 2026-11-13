// /api/v1/auth/oidc/connections/[tenantId] — the OIDC connection of one
// customer tenant (issue #1289), read and written by a provider admin. The
// provider IdP has its own route (/api/v1/auth/oidc) and is refused here.
import { NextResponse } from "next/server"

import { withAudit } from "@/lib/audit/withAudit"
import {
  appOriginOf,
  deleteTenantConnection,
  findCustomerTenant,
  saveTenantConnection,
  serializeTenantConnection,
} from "@/lib/auth/tenantOidcConnectionForm"
import { PERMISSIONS } from "@/lib/rbac"
import { requireProviderAdmin } from "@/lib/tenant/providerGuard"

export const runtime = "nodejs"

type Ctx = { params: Promise<{ tenantId: string }> }

/** Gate, then the customer tenant the URL names: a Response to answer, or the tenant. */
async function resolve(ctx: Ctx) {
  const denied = await requireProviderAdmin(PERMISSIONS.ADMIN_SETTINGS)
  if (denied) return { response: denied }
  const { tenantId } = await ctx.params
  if (tenantId === "default") {
    return { response: NextResponse.json({ error: "The provider IdP is configured in OIDC / SSO > Provider" }, { status: 400 }) }
  }
  const tenant = await findCustomerTenant(tenantId)
  if (!tenant) return { response: NextResponse.json({ error: "Tenant not found" }, { status: 404 }) }
  return { tenant }
}

export async function GET(req: Request, ctx: Ctx) {
  try {
    const { response, tenant } = await resolve(ctx)
    if (response) return response
    return NextResponse.json({ data: await serializeTenantConnection(tenant!, appOriginOf(req), { includeProxy: true }) })
  } catch (error: any) {
    console.error("Error GET tenant OIDC connection:", error)
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}

async function handlePut(req: Request, ctx: Ctx) {
  try {
    const { response, tenant } = await resolve(ctx)
    if (response) return response
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid body" }, { status: 400 })

    const refused = await saveTenantConnection(tenant!, body, { provider: true })
    if (refused) return NextResponse.json({ error: refused.error }, { status: refused.status })
    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error("Error PUT tenant OIDC connection:", error)
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}

async function handleDelete(_req: Request, ctx: Ctx) {
  try {
    const { response, tenant } = await resolve(ctx)
    if (response) return response
    await deleteTenantConnection(tenant!)
    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error("Error DELETE tenant OIDC connection:", error)
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}

export const PUT = withAudit({ category: "settings", resourceType: "oidc" }, handlePut)
export const DELETE = withAudit({ category: "settings", resourceType: "oidc" }, handleDelete)
