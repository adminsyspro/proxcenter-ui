// Who may manage which service accounts (issue #1404). A session needs
// admin.apitokens (admin.apitokens.view to read), a token the identity:* scope
// that maps them. The provider tenant reaches every tenant's accounts, any
// other tenant its own. A token is never wider than itself: it mints no scope
// it does not carry, and it never changes or deletes the account it acts as.
import { NextResponse } from "next/server"

import { getPrincipal, type Principal } from "@/lib/auth/principal"
import { requireFeature } from "@/lib/auth/requireEnterprise"
import { firstUngrantableScope, holdsScope } from "@/lib/api-tokens/grantable"
import { apiSelfServiceRefusal } from "@/lib/api-tokens/selfService"
import { Features } from "@/lib/license/features"
import { checkPermission, isUserSuperAdmin, PERMISSIONS } from "@/lib/rbac"
import { getCurrentTenantId, userHasAccessToTenant } from "@/lib/tenant"
import { DEFAULT_TENANT_ID } from "@/lib/tenant/constants"

import { getServiceAccount, ServiceAccountError, type ServiceAccountView } from "./index"

export const NOT_FOUND = "Service account not found"

/** Flat on purpose (tsconfig strict:false): `denied` set, or the caller. */
export type IdentityCaller = {
  denied: Response | null
  /** The caller's tenant; null for the provider, who reaches every tenant. */
  tenantScope: string | null
  callerTenantId: string
  principal: Principal | null
  /** Who mints: the session user, or the user behind the calling token (its account or its creator). */
  actingUserId: string | null
}

async function resolveCaller(permission: string): Promise<IdentityCaller> {
  const empty = { tenantScope: null, callerTenantId: DEFAULT_TENANT_ID, principal: null, actingUserId: null }
  const denied = await checkPermission(permission)
  if (denied) return { denied, ...empty }
  const result = await getPrincipal()
  const principal = result.ok ? result.principal ?? null : null
  const callerTenantId = await getCurrentTenantId()
  const closed = await apiSelfServiceRefusal(callerTenantId)
  if (closed) return { denied: closed, ...empty }
  return {
    denied: null,
    tenantScope: callerTenantId === DEFAULT_TENANT_ID ? null : callerTenantId,
    callerTenantId,
    principal,
    actingUserId: principal?.kind === "token" ? principal.creatorUserId ?? null : principal?.userId ?? null,
  }
}

export function identityReader(): Promise<IdentityCaller> {
  return resolveCaller(PERMISSIONS.ADMIN_APITOKENS_VIEW)
}

/** Writes also need the API Access option, like any token creation. */
export async function identityWriter(): Promise<IdentityCaller> {
  const caller = await resolveCaller(PERMISSIONS.ADMIN_APITOKENS)
  if (caller.denied) return caller
  const gate = await requireFeature(Features.API_ACCESS)
  return gate ? { ...caller, denied: gate } : caller
}

/** The tenant a creation lands in: the caller's own, or the one the provider names. */
export function targetTenantOf(caller: IdentityCaller, requested: unknown): string | null {
  const named = typeof requested === "string" && requested ? requested : null
  if (caller.tenantScope === null) return named ?? caller.callerTenantId
  return named && named !== caller.tenantScope ? null : caller.tenantScope
}

/** The account `id` if the caller reaches it, else null (answered as 404, never 403). */
export async function reachableServiceAccount(caller: IdentityCaller, id: string): Promise<ServiceAccountView | null> {
  const account = await getServiceAccount(id)
  if (!account) return null
  return caller.tenantScope === null || account.tenantId === caller.tenantScope ? account : null
}

/** A token never changes or deletes the account it acts as. */
export function selfChangeRefusal(caller: IdentityCaller, id: string): Response | null {
  if (caller.principal?.kind === "token" && caller.principal.serviceAccountId === id) {
    return NextResponse.json({ error: "An API token cannot change or delete its own service account" }, { status: 403 })
  }
  return null
}

export function notFound(): Response {
  return NextResponse.json({ error: NOT_FOUND }, { status: 404 })
}

export function errorResponse(e: unknown, context: string): Response {
  if (e instanceof ServiceAccountError) return NextResponse.json({ error: e.message }, { status: e.status })
  console.error(`[service-accounts] ${context}:`, (e as Error)?.message ?? e)
  return NextResponse.json({ error: "Server error" }, { status: 500 })
}

/**
 * Why the caller may not mint `scopes` for `account`, or null. Checked in
 * order: a token carries every scope it hands out; the person minting is a
 * member of the account's tenant and holds each creator-checked scope there
 * (anti-escalation, a super admin passes); the
 * account itself holds every one, reads included, since its roles bound the
 * token on each call.
 */
export async function mintRefusal(
  caller: IdentityCaller,
  account: ServiceAccountView,
  scopes: string[],
  connectionIds: string[] | null,
): Promise<Response | null> {
  if (caller.principal?.kind === "token") {
    const carried = new Set(caller.principal.scopes ?? [])
    const wider = scopes.find(s => !carried.has(s))
    if (wider) return NextResponse.json({ error: "An API token cannot grant a scope it does not carry", scope: wider }, { status: 403 })
  }
  try {
    const minter = caller.actingUserId
    if (!minter) return NextResponse.json({ error: "Unable to verify the scopes you can grant" }, { status: 403 })
    if (!(await isUserSuperAdmin(minter))) {
      // A secret for the account's tenant goes to a member of it only: the
      // provider reaches every tenant's accounts, not every tenant's data.
      if (!(await userHasAccessToTenant(minter, account.tenantId))) {
        return NextResponse.json({ error: "Tenant not accessible" }, { status: 403 })
      }
      const ungrantable = await firstUngrantableScope(minter, account.tenantId, scopes, connectionIds)
      if (ungrantable) return NextResponse.json({ error: "You cannot grant a scope you do not hold", scope: ungrantable }, { status: 403 })
    }
    for (const scope of scopes) {
      if (!(await holdsScope(account.id, account.tenantId, scope, connectionIds))) {
        return NextResponse.json(
          { error: "The service account does not hold this scope: grant it a role that does first", scope },
          { status: 400 },
        )
      }
    }
  } catch (e) {
    console.error("[service-accounts] held-rights lookup failed:", (e as Error)?.message ?? e)
    return NextResponse.json({ error: "Unable to verify the scopes you can grant" }, { status: 503 })
  }
  return null
}
