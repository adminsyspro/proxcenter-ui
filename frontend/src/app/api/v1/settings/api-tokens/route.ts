import { NextResponse } from "next/server"

import { nanoid } from "nanoid"

import { prisma } from "@/lib/db/prisma"
import { getCurrentTenantId, userHasAccessToTenant } from "@/lib/tenant"
import { requireFeature } from "@/lib/auth/requireEnterprise"
import { Features } from "@/lib/license/features"
import { generateApiToken } from "@/lib/api-tokens/tokenCrypto"
import { ALL_SCOPE_IDS, isWriteScope } from "@/lib/api-tokens/scopes"
import { firstUngrantableScope } from "@/lib/api-tokens/grantable"
import { audit } from "@/lib/audit"

import { requireApiTokenAdmin, TOKEN_VIEW_SELECT } from "./_shared"

export const runtime = "nodejs"

const DEFAULT_RATE_LIMIT_PER_MIN = 600
const DEFAULT_WRITE_RATE_LIMIT_PER_MIN = 60

// Management stays readable after option expiry (control_plane_ha
// precedent, spec D6): GET is NOT license-gated, only POST (creation) and
// the token usage path are.
export async function GET() {
  const guard = await requireApiTokenAdmin()
  if (!guard.ok) return guard.response!

  const ctx = guard.ctx!
  const where = ctx.isAdmin ? {} : { tenantId: await getCurrentTenantId() }
  const tokens = await prisma.apiToken.findMany({
    where,
    orderBy: { createdAt: "desc" },
    select: TOKEN_VIEW_SELECT,
  })
  return NextResponse.json({ data: tokens })
}

export async function POST(req: Request) {
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

  const name = typeof body?.name === "string" ? body.name.trim() : ""
  if (!name) return NextResponse.json({ error: "name is required" }, { status: 400 })

  const scopes: unknown = body?.scopes
  if (
    !Array.isArray(scopes) ||
    scopes.length === 0 ||
    scopes.some((s: unknown) => typeof s !== "string" || !ALL_SCOPE_IDS.includes(s))
  ) {
    return NextResponse.json({ error: "scopes must be a non-empty array of known scope ids" }, { status: 400 })
  }

  let connectionIds: string[] | null = null
  if (body?.connectionIds !== undefined && body?.connectionIds !== null) {
    if (!Array.isArray(body.connectionIds) || body.connectionIds.some((c: unknown) => typeof c !== "string" || !c)) {
      return NextResponse.json({ error: "connectionIds must be null or an array of connection ids" }, { status: 400 })
    }
    connectionIds = body.connectionIds
  }

  const tenantId = typeof body?.tenantId === "string" && body.tenantId ? body.tenantId : await getCurrentTenantId()
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true, enabled: true } })
  if (!tenant?.enabled) {
    return NextResponse.json({ error: "Target tenant is disabled or missing" }, { status: 400 })
  }
  if (!ctx.isAdmin && !(await userHasAccessToTenant(ctx.userId as string, tenantId))) {
    return NextResponse.json({ error: "Tenant not accessible" }, { status: 403 })
  }

  // Fix round 3, finding 1 (Task 12 review): connectionIds was only shape-
  // checked above, never verified to belong to tenantId. A wrong id would
  // still be persisted; scope.ts's read-time intersection against
  // getTenantConnectionIds() drops it silently (fail-closed, no cross-tenant
  // leak), but the token would then see nothing rather than what its
  // creator intended. Reject it up front instead of minting a blind token.
  if (connectionIds && connectionIds.length > 0) {
    const owned = await prisma.connection.findMany({
      where: { id: { in: connectionIds }, tenantId },
      select: { id: true },
    })
    const ownedIds = new Set(owned.map(c => c.id))
    if (connectionIds.some(id => !ownedIds.has(id))) {
      return NextResponse.json({ error: "connectionIds must belong to the target tenant" }, { status: 400 })
    }
  }

  if (!ctx.isAdmin) {
    // Fail closed: without a user id nothing can be proven held.
    let ungrantable: string | null | undefined
    try {
      ungrantable = ctx.userId
        ? await firstUngrantableScope(ctx.userId, tenantId, scopes as string[], connectionIds)
        : (scopes as string[]).find(isWriteScope)
    } catch (e: any) {
      // Fail closed; the lookup error stays in the logs.
      console.error("[api-tokens] held-rights lookup failed:", e?.message ?? e)
      return NextResponse.json({ error: "Unable to verify the scopes you can grant" }, { status: 503 })
    }
    if (ungrantable) {
      return NextResponse.json({ error: "You cannot grant a scope you do not hold", scope: ungrantable }, { status: 403 })
    }
  }

  let expiresAt: Date | null = null
  if (body?.expiresInDays !== undefined && body?.expiresInDays !== null) {
    const days = Number(body.expiresInDays)
    if (!Number.isFinite(days) || days <= 0) {
      return NextResponse.json({ error: "expiresInDays must be a positive number" }, { status: 400 })
    }
    expiresAt = new Date(Date.now() + days * 24 * 60 * 60 * 1000)
  }

  const rateLimitPerMin =
    body?.rateLimitPerMin !== undefined &&
    Number.isFinite(Number(body.rateLimitPerMin)) &&
    Number(body.rateLimitPerMin) > 0
      ? Math.floor(Number(body.rateLimitPerMin))
      : DEFAULT_RATE_LIMIT_PER_MIN

  const writeRateLimitPerMin =
    body?.writeRateLimitPerMin !== undefined &&
    Number.isFinite(Number(body.writeRateLimitPerMin)) &&
    Number(body.writeRateLimitPerMin) > 0
      ? Math.floor(Number(body.writeRateLimitPerMin))
      : DEFAULT_WRITE_RATE_LIMIT_PER_MIN

  const generated = generateApiToken()

  // Denormalised provenance (#632): read the creator's email once, here, and
  // freeze it on the row. Resolving it at display time through the FK would
  // return nothing precisely in the case that matters, after the account has
  // been deleted.
  const creator = ctx.userId
    ? await prisma.user.findUnique({ where: { id: ctx.userId }, select: { email: true } })
    : null

  // Atomic with the audit row (fix round 1, finding 1): if the audit insert
  // fails, the token creation must roll back too. Otherwise a caller could
  // get an error response while an active, unlogged credential (with its
  // one-time secret already lost) sits in the database.
  let token: any
  try {
    token = await prisma.$transaction(async tx => {
      const created = await tx.apiToken.create({
        data: {
          id: nanoid(),
          tenantId,
          name,
          description: typeof body?.description === "string" && body.description ? body.description : null,
          tokenPrefix: generated.prefix,
          tokenHash: generated.hash,
          scopes,
          connectionIds,
          expiresAt,
          rateLimitPerMin,
          writeRateLimitPerMin,
          createdByUserId: ctx.userId ?? null,
          createdByEmail: creator?.email ?? null,
        },
        select: TOKEN_VIEW_SELECT,
      })

      await audit(
        {
          action: "apitoken.create",
          category: "api_tokens",
          resourceType: "api_token",
          resourceId: created.id,
          resourceName: name,
          details: { tenantId, scopes, connectionIds, expiresAt: expiresAt?.toISOString() ?? null, writeRateLimitPerMin },
        },
        tx,
      )

      return created
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Internal server error" }, { status: 500 })
  }

  // ONE-TIME reveal: the clear secret is returned here and never again —
  // never persisted (only generated.hash is stored) and never included in
  // TOKEN_VIEW_SELECT, so GET can never leak it.
  return NextResponse.json({ data: { token, secret: generated.secret } }, { status: 201 })
}
