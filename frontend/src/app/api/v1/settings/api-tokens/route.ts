import { NextResponse } from "next/server"

import { prisma } from "@/lib/db/prisma"
import { getCurrentTenantId, userHasAccessToTenant } from "@/lib/tenant"
import { requireFeature } from "@/lib/auth/requireEnterprise"
import { Features } from "@/lib/license/features"
import { isCreatorCheckedScope } from "@/lib/api-tokens/scopes"
import { firstUngrantableScope } from "@/lib/api-tokens/grantable"
import { createApiToken, foreignConnectionsRefusal, parseTokenRequest, providerOnlyScopeRefusal } from "@/lib/api-tokens/mint"

import { requireApiTokenAdmin, seesEveryTenant, TOKEN_VIEW_SELECT } from "./_shared"
import { withAudit } from "@/lib/audit/withAudit"

export const runtime = "nodejs"

// Management stays readable after option expiry (control_plane_ha
// precedent, spec D6): GET is NOT license-gated, only POST (creation) and
// the token usage path are.
export async function GET() {
  const guard = await requireApiTokenAdmin()
  if (!guard.ok) return guard.response!

  const ctx = guard.ctx!
  const where = (await seesEveryTenant(ctx)) ? {} : { tenantId: await getCurrentTenantId() }
  const tokens = await prisma.apiToken.findMany({
    where,
    orderBy: { createdAt: "desc" },
    select: TOKEN_VIEW_SELECT,
  })
  return NextResponse.json({ data: tokens })
}

async function handlePost(req: Request) {
  const guard = await requireApiTokenAdmin()
  if (!guard.ok) return guard.response!

  const gate = await requireFeature(Features.API_ACCESS)
  if (gate) return gate

  const ctx = guard.ctx!

  let body: any
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const parsed = parseTokenRequest(body)
  if (parsed.refusal) return NextResponse.json(parsed.refusal.body, { status: parsed.refusal.status })
  const request = parsed.request!

  const tenantId = typeof body?.tenantId === "string" && body.tenantId ? body.tenantId : await getCurrentTenantId()
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true, enabled: true } })
  if (!tenant?.enabled) {
    return NextResponse.json({ error: "Target tenant is disabled or missing" }, { status: 400 })
  }
  if (!ctx.isAdmin && !(await userHasAccessToTenant(ctx.userId as string, tenantId))) {
    return NextResponse.json({ error: "Tenant not accessible" }, { status: 403 })
  }

  const providerOnly = providerOnlyScopeRefusal(request.scopes, tenantId)
  if (providerOnly) return NextResponse.json(providerOnly.body, { status: providerOnly.status })
  const foreign = await foreignConnectionsRefusal(request.connectionIds, tenantId)
  if (foreign) return NextResponse.json(foreign.body, { status: foreign.status })

  if (!ctx.isAdmin) {
    // Fail closed: without a user id nothing can be proven held.
    let ungrantable: string | null | undefined
    try {
      ungrantable = ctx.userId
        ? await firstUngrantableScope(ctx.userId, tenantId, request.scopes, request.connectionIds)
        : request.scopes.find(isCreatorCheckedScope)
    } catch (e: any) {
      // Fail closed; the lookup error stays in the logs.
      console.error("[api-tokens] held-rights lookup failed:", e?.message ?? e)
      return NextResponse.json({ error: "Unable to verify the scopes you can grant" }, { status: 503 })
    }
    if (ungrantable) {
      return NextResponse.json({ error: "You cannot grant a scope you do not hold", scope: ungrantable }, { status: 403 })
    }
  }

  let created: { token: any; secret: string }
  try {
    created = await createApiToken({ tenantId, request, createdByUserId: ctx.userId ?? null, select: TOKEN_VIEW_SELECT })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Internal server error" }, { status: 500 })
  }

  // ONE-TIME reveal: the clear secret is returned here and never again --
  // never persisted (only its hash is stored) and never included in
  // TOKEN_VIEW_SELECT, so GET can never leak it.
  return NextResponse.json({ data: { token: created.token, secret: created.secret } }, { status: 201 })
}

export const POST = withAudit({ category: "api_tokens", resourceType: "api_token" }, handlePost)
