// Shared preamble for the api-tokens management handlers (GET, POST here;
// DELETE in ./[id]/route.ts). Extracted so the three handlers don't triple
// the same "checkPermission + getRBACContext" lines (Sonar new-code
// duplication gate). tsconfig has strict: false, so this uses a flat
// { ok, response?, ctx? } shape rather than a discriminated union — union
// narrowing on strict:false is not reliable (see task-11 binding
// constraints).
import { NextResponse } from "next/server"

import { checkPermission, getRBACContext, PERMISSIONS } from "@/lib/rbac"
import { getCurrentTenantId } from "@/lib/tenant"

export const TOKEN_VIEW_SELECT = {
  id: true,
  tenantId: true,
  // tenantId alone is an opaque cuid, useless in a table -- join the human
  // -readable name server-side rather than making callers fetch
  // /api/v1/tenants themselves (that route needs ADMIN_TENANTS, which an
  // admin.apitokens holder may not have).
  tenant: { select: { name: true } },
  name: true,
  description: true,
  tokenPrefix: true,
  scopes: true,
  connectionIds: true,
  expiresAt: true,
  revokedAt: true,
  lastUsedAt: true,
  lastUsedIp: true,
  rateLimitPerMin: true,
  createdByUserId: true,
  // Frozen copy of the creator's email (#632). createdByUserId goes NULL when
  // the account is deleted while the token stays valid, so it cannot answer
  // "who minted this credential" on its own -- and the audit row only
  // answers it for as long as audit retention keeps it.
  createdByEmail: true,
  createdAt: true,
} as const

export type ApiTokenRbacContext = {
  userId?: string
  isAdmin: boolean
  tenantId: string
}

export type AdminGuardResult = {
  ok: boolean
  response?: NextResponse
  ctx?: ApiTokenRbacContext
}

/**
 * Verify admin.apitokens, then resolve the RBAC context. GET, POST and
 * DELETE all start with this — none of them are license-gated by
 * themselves (only POST additionally calls requireFeature, spec D6).
 */
export async function requireApiTokenAdmin(): Promise<AdminGuardResult> {
  const denied = await checkPermission(PERMISSIONS.ADMIN_APITOKENS)
  if (denied) return { ok: false, response: denied }

  const ctx = await getRBACContext()
  if (!ctx) {
    return { ok: false, response: NextResponse.json({ error: "Not authenticated" }, { status: 401 }) }
  }

  return { ok: true, ctx }
}

/** Whether a row belonging to `tenantId` is visible to this caller: super admins see every tenant, everyone else only their own. */
export async function tenantVisibleToCaller(ctx: ApiTokenRbacContext, tenantId: string): Promise<boolean> {
  if (ctx.isAdmin) return true
  return tenantId === (await getCurrentTenantId())
}
