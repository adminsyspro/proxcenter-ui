// Unified principal resolution (spec 2026-07-28, section 6). The session
// fallback (getServerSession) lives HERE and nowhere else: the contract
// tests assert that no allowlisted route reaches getServerSession through
// any other module. No React cache() memoization: route handlers are not a
// React tree. The route-boundary guard resolves once with recordUsage; the
// identity helpers resolve without side effects (no quota, no last_used).
import { headers } from "next/headers"
import { NextResponse } from "next/server"

import { prisma } from "@/lib/db/prisma"
import { DEFAULT_TENANT_ID } from "@/lib/tenant/constants"
import { extractTokenPrefix, verifyTokenHash } from "@/lib/api-tokens/tokenCrypto"
import { touchTokenUsage } from "@/lib/api-tokens/lastUsed"
import { getAllowlistEntryById, matchesEntry } from "@/lib/api-tokens/allowlist"
import { expandScopes } from "@/lib/api-tokens/scopes"
import { isApiAccessLicensed } from "@/lib/api-tokens/licenseGate"
import { consumeRateLimit } from "@/lib/api-tokens/rateLimit"
import { Features } from "@/lib/license/features"

// FLAT type on purpose: tsconfig strict:false breaks discriminated-union
// narrowing, so callers test principal.kind and read optional fields.
export type Principal = {
  kind: "session" | "token"
  tenantId: string
  userId?: string
  userEmail?: string
  tokenId?: string
  permissions?: Set<string>
  /** Raw scope ids as granted (token principals only): the metrics endpoint
   * filters series families on these, not on the expanded permissions. */
  scopes?: string[]
  /**
   * REQUIRED, never optional (Task 18 hard gate 3 follow-up): "unrestricted"
   * must be STATED as an explicit `null`, never obtained by a caller
   * forgetting the field. A session principal has no token perimeter to
   * speak of, so it states `null` too, same as an unrestricted token.
   */
  connectionIds: string[] | null
}

export type PrincipalRejection = {
  status: number
  body: Record<string, unknown>
  headers?: Record<string, string>
}

export type RateLimitInfo = { limit: number; remaining: number; reset: number }

export type PrincipalResult = {
  ok: boolean
  principal?: Principal
  rejection?: PrincipalRejection
  rateLimit?: RateLimitInfo
}

export type GetPrincipalOptions = {
  /** True at the route-boundary guard ONLY: counts quota and touches last_used. */
  recordUsage?: boolean
}

const INVALID_TOKEN: PrincipalRejection = {
  status: 401,
  body: { error: "Invalid or expired API token" },
  headers: { "WWW-Authenticate": 'Bearer realm="proxcenter"' },
}

function reject(rejection: PrincipalRejection): PrincipalResult {
  return { ok: false, rejection }
}

async function sessionPrincipal(): Promise<PrincipalResult> {
  // Dynamic imports keep this module import-cycle-free (tenant/ and rbac/
  // import principal.ts). Precedent: frontend/src/lib/vdc/scope.ts:331.
  const { getServerSession } = await import("next-auth")
  const { authOptions } = await import("@/lib/auth/config")
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) return { ok: true }
  return {
    ok: true,
    principal: {
      kind: "session",
      userId: session.user.id,
      userEmail: session.user.email || undefined,
      tenantId: (session as any)?.user?.tenantId || DEFAULT_TENANT_ID,
      // No token perimeter applies to a session caller: stated explicitly
      // as unrestricted rather than left to be inferred from absence.
      connectionIds: null,
    },
  }
}

export async function getPrincipal(options: GetPrincipalOptions = {}): Promise<PrincipalResult> {
  // 1. Authorization via headers(), same mechanism as audit
  //    (frontend/src/lib/audit/index.ts:142).
  const hdrs = await headers()
  const authorization = hdrs.get("authorization") || ""

  // 2. No Bearer pxc_: browser behavior unchanged bit for bit.
  if (!authorization.startsWith("Bearer pxc_")) {
    return sessionPrincipal()
  }

  // 3. Fail-closed: the internal headers MUST come from the middleware.
  //    A handler can be reached without crossing it (direct import in tests,
  //    dotted-path isAsset bypass, future internal caller): 401, never a
  //    fallback to trusting the Bearer.
  const method = hdrs.get("x-pxc-method")
  const path = hdrs.get("x-pxc-path")
  const entryId = hdrs.get("x-pxc-entry")
  const entry = entryId ? getAllowlistEntryById(entryId) : null
  if (!method || !path || !entry) return reject(INVALID_TOKEN)

  // 4. Read-only before ANY scope consultation (D1).
  if (method !== "GET" && method !== "HEAD") {
    return reject({
      status: 405,
      body: { error: "API tokens are read-only", method },
      headers: { Allow: "GET, HEAD" },
    })
  }

  // 5. Single indexed SQL lookup by prefix, NO cache (immediate revocation, D5).
  const secret = authorization.slice("Bearer ".length)
  const prefix = extractTokenPrefix(secret)
  if (!prefix) return reject(INVALID_TOKEN)
  const token = await prisma.apiToken.findUnique({ where: { tokenPrefix: prefix } })

  // 6. Constant-time hash compare; missing row, revoked or expired: identical
  //    401 (no oracle distinguishing the cases).
  if (
    !token ||
    !verifyTokenHash(secret, token.tokenHash) ||
    token.revokedAt !== null ||
    (token.expiresAt !== null && token.expiresAt.getTime() <= Date.now())
  ) {
    return reject(INVALID_TOKEN)
  }

  // 7. Tenant must exist AND be enabled. Never the session-path fallback to
  //    DEFAULT_TENANT_ID: for a token that would be a silent promotion to the
  //    provider tenant (spec section 10).
  const tenant = await prisma.tenant.findUnique({
    where: { id: token.tenantId },
    select: { id: true, enabled: true },
  })
  if (!tenant || !tenant.enabled) {
    return reject({ status: 403, body: { error: "API token tenant is disabled or missing" } })
  }

  // 8. License verdict behind the 60s cache (D6, fail-closed, no grace period).
  if (!(await isApiAccessLicensed())) {
    return reject({
      status: 403,
      body: { error: "Feature not licensed", feature: Features.API_ACCESS },
    })
  }

  // 9. Rate limit, counted BEFORE the scope check so every authenticated call
  //    consumes quota. Counted only at the route boundary (recordUsage):
  //    identity helpers never double-count.
  let rateLimit: RateLimitInfo | undefined
  if (options.recordUsage) {
    const verdict = consumeRateLimit(token.id, token.rateLimitPerMin)
    rateLimit = { limit: verdict.limit, remaining: verdict.remaining, reset: verdict.reset }
    if (!verdict.allowed) {
      return reject({
        status: 429,
        body: { error: "Rate limit exceeded", retryAfter: verdict.retryAfter },
        headers: {
          "Retry-After": String(verdict.retryAfter),
          "RateLimit-Limit": String(verdict.limit),
          "RateLimit-Remaining": "0",
          "RateLimit-Reset": String(verdict.reset),
        },
      })
    }
  }

  // 10. Re-verify x-pxc-path against the ONE designated entry (never a free
  //     re-match), then anyOf scope check (empty list = any valid token).
  if (!matchesEntry(entry, path)) return reject(INVALID_TOKEN)
  const scopes = Array.isArray(token.scopes) ? (token.scopes as string[]) : []
  if (entry.requiredScopes.length > 0 && !entry.requiredScopes.some(s => scopes.includes(s))) {
    return reject({
      status: 403,
      body: { error: "Route not available to API tokens", route: path },
    })
  }

  // 11. Expand scopes, build the principal, conditional last_used update.
  if (options.recordUsage) {
    const ip = hdrs.get("x-forwarded-for") || hdrs.get("x-real-ip") || null
    await touchTokenUsage(token.id, ip)
  }

  return {
    ok: true,
    rateLimit,
    principal: {
      kind: "token",
      tokenId: token.id,
      tenantId: token.tenantId,
      permissions: expandScopes(scopes),
      scopes,
      connectionIds: Array.isArray(token.connectionIds) ? (token.connectionIds as string[]) : null,
    },
  }
}

export type TokenPrincipalContext = {
  rejected: boolean
  rejection?: PrincipalRejection
  principal?: Principal
}

/**
 * Ambient token detection for the identity functions (checkPermission,
 * getCurrentTenantId, getRBACContext, audit). No Bearer: inert, the caller
 * keeps its session path. Invalid Bearer: rejected, NEVER a session fallback.
 */
export async function getTokenPrincipalContext(): Promise<TokenPrincipalContext> {
  const hdrs = await headers()
  const authorization = hdrs.get("authorization") || ""
  if (!authorization.startsWith("Bearer pxc_")) return { rejected: false }
  const result = await getPrincipal()
  if (!result.ok) return { rejected: true, rejection: result.rejection }
  return { rejected: false, principal: result.principal }
}

export function rejectionToResponse(rejection?: PrincipalRejection): NextResponse {
  const r = rejection || INVALID_TOKEN
  return NextResponse.json(r.body, { status: r.status, headers: r.headers })
}
