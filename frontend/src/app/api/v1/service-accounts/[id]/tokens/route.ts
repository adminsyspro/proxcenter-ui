// /api/v1/service-accounts/{id}/tokens (issue #1404): the tokens of a service
// account, and the creation of one. The secret is returned once. Several live
// tokens per account allow a rotation without downtime.
import { NextResponse } from "next/server"

import { prisma } from "@/lib/db/prisma"
import { createApiToken, foreignConnectionsRefusal, parseTokenRequest, providerOnlyScopeRefusal } from "@/lib/api-tokens/mint"
import { withPublicApiGuard } from "@/lib/api-tokens/routeGuard"
import { withAudit } from "@/lib/audit/withAudit"
import {
  identityReader, identityWriter, mintRefusal, notFound, reachableServiceAccount,
} from "@/lib/service-accounts/access"
import { TOKEN_VIEW_SELECT } from "@/app/api/v1/settings/api-tokens/_shared"

export const runtime = "nodejs"

type Ctx = { params: Promise<{ id: string }> }

async function handleGet(_req: Request, ctx: Ctx) {
  const caller = await identityReader()
  if (caller.denied) return caller.denied
  const { id } = await ctx.params
  if (!(await reachableServiceAccount(caller, id))) return notFound()
  const tokens = await prisma.apiToken.findMany({
    where: { serviceAccountId: id },
    orderBy: { createdAt: "desc" },
    select: TOKEN_VIEW_SELECT,
  })
  return NextResponse.json({ data: tokens })
}

async function handlePost(req: Request, ctx: Ctx) {
  const caller = await identityWriter()
  if (caller.denied) return caller.denied
  const { id } = await ctx.params
  const account = await reachableServiceAccount(caller, id)
  if (!account) return notFound()
  if (!account.enabled) return NextResponse.json({ error: "The service account is disabled" }, { status: 409 })

  const body = await req.json().catch(() => null)
  const parsed = parseTokenRequest(body)
  if (parsed.refusal) return NextResponse.json(parsed.refusal.body, { status: parsed.refusal.status })
  const request = parsed.request!

  const providerOnly = providerOnlyScopeRefusal(request.scopes, account.tenantId)
  if (providerOnly) return NextResponse.json(providerOnly.body, { status: providerOnly.status })
  const foreign = await foreignConnectionsRefusal(request.connectionIds, account.tenantId)
  if (foreign) return NextResponse.json(foreign.body, { status: foreign.status })
  const refused = await mintRefusal(caller, account, request.scopes, request.connectionIds)
  if (refused) return refused

  try {
    const created = await createApiToken({
      tenantId: account.tenantId,
      request,
      createdByUserId: caller.actingUserId,
      serviceAccountId: account.id,
      select: TOKEN_VIEW_SELECT,
    })
    return NextResponse.json({ data: created }, { status: 201 })
  } catch (e) {
    console.error("[service-accounts] token creation failed:", (e as Error)?.message ?? e)
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}

export const GET = withPublicApiGuard("service-account-tokens-list", handleGet)
export const POST = withAudit({ category: "api_tokens", resourceType: "api_token", resourceNameBodyField: "name" }, withPublicApiGuard("service-account-token-create", handlePost))
