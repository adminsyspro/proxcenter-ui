// /api/v1/tenant/identity — the session tenant's own OIDC connection, managed
// by its admin once the provider opened self-service (issue #1289, lot 2).
// The outbound proxy stays the provider's: never read nor written here.
import { NextResponse } from "next/server"

import { withAudit } from "@/lib/audit/withAudit"
import { resolveTenantIdentity } from "@/lib/auth/tenantIdentityGate"
import { appOriginOf, saveTenantConnection, serializeTenantConnection } from "@/lib/auth/tenantOidcConnectionForm"

export const runtime = "nodejs"

export async function GET(req: Request) {
  try {
    const { response, tenant } = await resolveTenantIdentity()
    if (response) return response
    return NextResponse.json({ data: await serializeTenantConnection(tenant!, appOriginOf(req), { includeProxy: false }) })
  } catch (error: any) {
    console.error("Error GET tenant identity:", error)
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}

async function handlePut(req: Request) {
  try {
    const { response, tenant } = await resolveTenantIdentity()
    if (response) return response
    const body = await req.json().catch(() => null)
    if (!body || typeof body !== "object") return NextResponse.json({ error: "Invalid body" }, { status: 400 })

    const refused = await saveTenantConnection(tenant!, body, { provider: false })
    if (refused) return NextResponse.json({ error: refused.error }, { status: refused.status })
    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error("Error PUT tenant identity:", error)
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}

export const PUT = withAudit({ category: "settings", resourceType: "oidc" }, handlePut)
