// /api/v1/service-accounts/{id}/tokens/{tokenId}/rotate (issue #1404): a new
// secret for one token of a service account, as Settings > API does for any
// token. Everything else stays, the old secret stops at once. Rotating hands
// out a working secret, so it follows the rules of minting one: a token
// carries every scope of the token it rotates, the person holds each of them,
// and so does the account. A token may rotate itself.
import { NextResponse } from "next/server"

import { prisma } from "@/lib/db/prisma"
import { rotateApiToken } from "@/lib/api-tokens/mint"
import { withPublicApiGuard } from "@/lib/api-tokens/routeGuard"
import { withAudit } from "@/lib/audit/withAudit"
import { identityWriter, mintRefusal, notFound, reachableServiceAccount } from "@/lib/service-accounts/access"
import { TOKEN_VIEW_SELECT } from "@/app/api/v1/settings/api-tokens/_shared"

export const runtime = "nodejs"

type Ctx = { params: Promise<{ id: string; tokenId: string }> }

async function handlePost(_req: Request, ctx: Ctx) {
  const caller = await identityWriter()
  if (caller.denied) return caller.denied
  const { id, tokenId } = await ctx.params
  const account = await reachableServiceAccount(caller, id)
  if (!account) return notFound()
  const token = await prisma.apiToken.findFirst({
    where: { id: tokenId, serviceAccountId: id },
    select: { id: true, name: true, tokenPrefix: true, scopes: true, connectionIds: true },
  })
  if (!token) return NextResponse.json({ error: "API token not found" }, { status: 404 })
  if (!account.enabled) return NextResponse.json({ error: "The service account is disabled" }, { status: 409 })

  const scopes = Array.isArray(token.scopes) ? (token.scopes as string[]) : []
  const connectionIds = Array.isArray(token.connectionIds) ? (token.connectionIds as string[]) : null
  const refused = await mintRefusal(caller, account, scopes, connectionIds)
  if (refused) return refused

  try {
    const rotated = await rotateApiToken({
      id: token.id,
      name: token.name,
      previousPrefix: token.tokenPrefix,
      rotatedByUserId: caller.actingUserId,
      select: TOKEN_VIEW_SELECT,
    })
    return NextResponse.json({ data: rotated })
  } catch (e) {
    console.error("[service-accounts] token rotation failed:", (e as Error)?.message ?? e)
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}

export const POST = withAudit({ category: "api_tokens", resourceType: "api_token", resourceParam: "tokenId" }, withPublicApiGuard("service-account-token-rotate", handlePost))
