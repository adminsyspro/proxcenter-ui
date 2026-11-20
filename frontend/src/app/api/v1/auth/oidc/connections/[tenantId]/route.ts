// /api/v1/auth/oidc/connections/[tenantId] — the OIDC connection of one
// customer tenant (issue #1289), read and written by a provider admin. The
// provider IdP has its own route (/api/v1/auth/oidc) and is refused here.
// Open to provider API tokens (issue #1404): identity:read reads it,
// identity:write writes it; the client secret is never returned.
import { NextResponse } from "next/server"

import { withAudit } from "@/lib/audit/withAudit"
import { withPublicApiGuard } from "@/lib/api-tokens/routeGuard"
import {
  appOriginOf,
  deleteTenantConnection,
  findCustomerTenant,
  saveTenantConnection,
  serializeTenantConnection,
} from "@/lib/auth/tenantOidcConnectionForm"
import { PERMISSIONS } from "@/lib/rbac"
import type { Principal } from "@/lib/auth/principal"
import { requireProviderAdmin } from "@/lib/tenant/providerGuard"

export const runtime = "nodejs"

type Ctx = { params: Promise<{ tenantId: string }>; principal?: Principal }

/** Gate, then the customer tenant the URL names: a Response to answer, or the tenant. */
async function resolve(ctx: Ctx, permission: string) {
  const denied = await requireProviderAdmin(permission)
  if (denied) return { response: denied }
  const { tenantId } = await ctx.params
  if (tenantId === "default") {
    return { response: NextResponse.json({ error: "The provider IdP is configured in OIDC / SSO > Provider" }, { status: 400 }) }
  }
  const tenant = await findCustomerTenant(tenantId)
  if (!tenant) return { response: NextResponse.json({ error: "Tenant not found" }, { status: 404 }) }
  return { tenant }
}

async function handleGet(req: Request, ctx: Ctx) {
  try {
    const { response, tenant } = await resolve(ctx, PERMISSIONS.ADMIN_SETTINGS_VIEW)
    if (response) return response
    return NextResponse.json({ data: await serializeTenantConnection(tenant!, appOriginOf(req), { includeProxy: true }) })
  } catch (error: any) {
    console.error("Error GET tenant OIDC connection:", error)
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}

async function handlePut(req: Request, ctx: Ctx) {
  try {
    const { response, tenant } = await resolve(ctx, PERMISSIONS.ADMIN_SETTINGS_IDENTITY)
    if (response) return response
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid body" }, { status: 400 })
    // Trusting a tenant's endpoints lifts the private-address check: a
    // provider session decision, never an automation's (issue #1404).
    if (ctx.principal?.kind === "token" && body.trusted_endpoints === true) {
      return NextResponse.json({ error: "An API token cannot trust a tenant's endpoints" }, { status: 403 })
    }

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
    const { response, tenant } = await resolve(ctx, PERMISSIONS.ADMIN_SETTINGS_IDENTITY)
    if (response) return response
    await deleteTenantConnection(tenant!)
    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error("Error DELETE tenant OIDC connection:", error)
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}

export const GET = withPublicApiGuard("tenant-oidc-connection-get", handleGet)
export const PUT = withAudit({ category: "settings", resourceType: "oidc" }, withPublicApiGuard("tenant-oidc-connection-update", handlePut))
export const DELETE = withAudit({ category: "settings", resourceType: "oidc" }, withPublicApiGuard("tenant-oidc-connection-delete", handleDelete))
