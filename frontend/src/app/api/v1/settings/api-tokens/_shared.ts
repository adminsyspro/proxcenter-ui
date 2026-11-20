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
import { DEFAULT_TENANT_ID } from "@/lib/tenant/constants"
import { apiSelfServiceRefusal } from "@/lib/api-tokens/selfService"

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
  writeRateLimitPerMin: true,
  createdByUserId: true,
  // Frozen copy of the creator's email (#632). createdByUserId goes NULL when
  // the account is deleted while the token stays valid, so it cannot answer
  // "who minted this credential" on its own -- and the audit row only
  // answers it for as long as audit retention keeps it.
  createdByEmail: true,
  // The service account the token acts as (issue #1404): the grid names it
  // instead of the person who minted it.
  serviceAccountId: true,
  serviceAccount: { select: { name: true } },
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

  // A customer tenant manages its tokens once the provider opened it (issue #1404).
  const closed = await apiSelfServiceRefusal(await getCurrentTenantId())
  if (closed) return { ok: false, response: closed as NextResponse }

  return { ok: true, ctx }
}

/** Whether the caller reaches every tenant's tokens: a super admin, or anyone in the provider tenant (issue #1404). */
export async function seesEveryTenant(ctx: ApiTokenRbacContext): Promise<boolean> {
  return ctx.isAdmin || (await getCurrentTenantId()) === DEFAULT_TENANT_ID
}

/** Whether a row belonging to `tenantId` is visible to this caller: the provider sees every tenant, a customer tenant its own. */
export async function tenantVisibleToCaller(ctx: ApiTokenRbacContext, tenantId: string): Promise<boolean> {
  if (await seesEveryTenant(ctx)) return true
  return tenantId === (await getCurrentTenantId())
}
