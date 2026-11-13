import { NextResponse } from "next/server"

import { prisma } from "@/lib/db/prisma"
import { audit } from "@/lib/audit"
import { withAudit } from "@/lib/audit/withAudit"
import { requireFeature } from "@/lib/auth/requireEnterprise"
import { Features } from "@/lib/license/features"
import { firstUngrantableScope } from "@/lib/api-tokens/grantable"
import { isCreatorCheckedScope } from "@/lib/api-tokens/scopes"
import { generateApiToken } from "@/lib/api-tokens/tokenCrypto"

import { requireApiTokenAdmin, tenantVisibleToCaller, TOKEN_VIEW_SELECT } from "../../_shared"

export const runtime = "nodejs"

// Rotation: the token keeps its id, name, scopes, tenant, connections, expiry
// and rate limits; only its secret (and so its prefix) changes. The old secret
// stops authenticating at once: the lookup by prefix has no cache.
//
// Whoever rotates receives a working secret, so they answer for it exactly as
// if they had created the token: they must be able to grant every one of its
// scopes, and they become its creator, the account the live rights check
// follows on each call. A token therefore never outlives the rights of the
// person holding its secret.
//
// License-gated like creation (D6): handing out a new secret is not part of
// what stays available once the option lapses.
async function handlePost(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const guard = await requireApiTokenAdmin()
  if (!guard.ok) return guard.response!

  const gate = await requireFeature(Features.API_ACCESS)
  if (gate) return gate

  const rbac = guard.ctx!
  const { id } = await ctx.params

  const token = await prisma.apiToken.findUnique({
    where: { id },
    select: { id: true, name: true, tenantId: true, tokenPrefix: true, scopes: true, connectionIds: true, revokedAt: true },
  })
  const visible = token && (await tenantVisibleToCaller(rbac, token.tenantId))
  if (!visible) return NextResponse.json({ error: "API token not found" }, { status: 404 })

  // A legacy soft-revoked row stays refused at authentication whatever its
  // secret: a new one would be handed out for nothing.
  if (token.revokedAt) {
    return NextResponse.json({ error: "A revoked token cannot be rotated: delete it and create a new one" }, { status: 409 })
  }

  const scopes = Array.isArray(token.scopes) ? (token.scopes as string[]) : []
  const connectionIds = Array.isArray(token.connectionIds) ? (token.connectionIds as string[]) : null
  if (!rbac.isAdmin) {
    // Fail closed: without a user id nothing can be proven held.
    let ungrantable: string | null | undefined
    try {
      ungrantable = rbac.userId
        ? await firstUngrantableScope(rbac.userId, token.tenantId, scopes, connectionIds)
        : scopes.find(isCreatorCheckedScope)
    } catch (e: any) {
      console.error("[api-tokens] held-rights lookup failed:", e?.message ?? e)
      return NextResponse.json({ error: "Unable to verify the scopes you can grant" }, { status: 503 })
    }
    if (ungrantable) {
      return NextResponse.json(
        { error: "You cannot rotate a token carrying a scope you do not hold", scope: ungrantable },
        { status: 403 },
      )
    }
  }

  const generated = generateApiToken()
  const rotator = rbac.userId
    ? await prisma.user.findUnique({ where: { id: rbac.userId }, select: { email: true } })
    : null

  // Atomic with the audit row, like creation and deletion: a secret that
  // changed with no journal entry would leave an unexplained outage behind.
  let rotated: unknown
  try {
    rotated = await prisma.$transaction(async tx => {
      const updated = await tx.apiToken.update({
        where: { id },
        data: {
          tokenPrefix: generated.prefix,
          tokenHash: generated.hash,
          createdByUserId: rbac.userId ?? null,
          createdByEmail: rotator?.email ?? null,
        },
        select: TOKEN_VIEW_SELECT,
      })
      await audit(
        {
          action: "apitoken.rotate",
          category: "api_tokens",
          resourceType: "api_token",
          resourceId: id,
          resourceName: token.name,
          // Prefixes, never secrets: they tell which credential stopped
          // working and which one replaced it.
          details: { previousPrefix: token.tokenPrefix, tokenPrefix: generated.prefix },
        },
        tx,
      )
      return updated
    })
  } catch (e: any) {
    console.error("[api-tokens] rotation failed:", e?.message ?? e)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }

  // ONE-TIME reveal, as on creation: the clear secret is never stored.
  return NextResponse.json({ data: { token: rotated, secret: generated.secret } })
}

export const POST = withAudit({ category: "api_tokens", resourceType: "api_token", resourceParam: "id" }, handlePost)
