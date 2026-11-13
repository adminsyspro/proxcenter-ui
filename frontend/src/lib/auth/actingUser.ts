// The signed-in user acting on a request, for attribution (createdBy, audit
// rows) and super-admin checks. Resolved through getPrincipal, the one module
// allowed to read the session, so a route reachable by API tokens never reads
// it on its own (issue #1360). A token carries no user: null, as for an
// anonymous caller.
import { NextResponse } from "next/server"

import { getPrincipal } from "@/lib/auth/principal"
import { checkPermission, getRBACContext, hasPermission } from "@/lib/rbac"

export type ActingUser = { id: string; email?: string }

export async function getActingUser(): Promise<ActingUser | null> {
  const result = await getPrincipal()
  const principal = result.ok ? result.principal : undefined
  if (principal?.kind !== "session" || !principal.userId) return null
  return { id: principal.userId, email: principal.userEmail }
}

/**
 * The acting user in the `{ user }` shape of a next-auth session, for the
 * session-only handlers of a module that also serves token reads: they keep
 * reading `session.user.id` / `session?.user?.email` unchanged.
 */
export async function getActingSession(): Promise<{ user: ActingUser } | null> {
  const user = await getActingUser()
  return user ? { user } : null
}

export type AdminReader = {
  /** The refusal to send, or null to proceed. */
  denied: Response | null
  /** The session user; undefined for a token. */
  userId?: string
  /** False for a token, which is never a super admin. */
  isSuperAdmin: boolean
}

/**
 * Gate of an administration read that a session has always reached once
 * signed in (roles, permissions, assignments): a session proceeds as before,
 * a token needs `viewPermission` (its read scope) on top of the route scope.
 */
export async function authorizeAdminRead(viewPermission: string): Promise<AdminReader> {
  const ctx = await getRBACContext()
  if (ctx?.principal?.kind === "token") {
    return { denied: await checkPermission(viewPermission), isSuperAdmin: false }
  }
  if (!ctx?.userId) {
    return { denied: NextResponse.json({ error: "Unauthorized" }, { status: 401 }), isSuperAdmin: false }
  }
  return { denied: null, userId: ctx.userId, isSuperAdmin: ctx.isAdmin }
}

export type AdminWriter = {
  /** The refusal to send, or null to proceed. */
  denied: Response | null
  /** The session user; undefined for a token, which is attributed in the audit trail by its own id. */
  userId?: string
  userEmail?: string
  /**
   * The account the "not on yourself" rules protect: the session user, or the
   * creator of the token. A token must not do to its creator what the creator
   * could not do to themselves (own roles, own account).
   */
  selfUserId: string | null
  isToken: boolean
}

/**
 * Gate of an administration write that checks the caller's right itself: a
 * session needs `permission` in its tenant, as before; a token needs it from
 * its write scope. A token is never a super admin, so every rule reserved to
 * one refuses it downstream.
 */
export async function authorizeAdminWrite(permission: string): Promise<AdminWriter> {
  const ctx = await getRBACContext()
  if (ctx?.principal?.kind === "token") {
    return {
      denied: await checkPermission(permission),
      selfUserId: ctx.principal.creatorUserId ?? null,
      isToken: true,
    }
  }
  if (!ctx?.userId) {
    return { denied: NextResponse.json({ error: "Unauthorized" }, { status: 401 }), selfUserId: null, isToken: false }
  }
  const { getCurrentTenantId } = await import("@/lib/tenant")
  const allowed = await hasPermission({ userId: ctx.userId, permission, tenantId: await getCurrentTenantId() })
  return {
    denied: allowed ? null : NextResponse.json({ error: "Admin rights required" }, { status: 403 }),
    userId: ctx.userId,
    userEmail: ctx.principal?.userEmail,
    selfUserId: ctx.userId,
    isToken: false,
  }
}

/** The refusal of a role change aimed at the caller's own account, or at the creator of the calling token. */
export function ownRolesError(writer: Pick<AdminWriter, "isToken">, verb: "change" | "revoke"): string {
  return writer.isToken ? `An API token cannot ${verb} the roles of its creator` : `You cannot ${verb} your own roles`
}

export type TokenCaller = { creatorUserId: string | null }

/**
 * The calling API token, or null for a session: lets a handler apply the
 * rules a token obeys on top of its permission check (never on its creator,
 * never a credential).
 */
export async function getTokenCaller(): Promise<TokenCaller | null> {
  const result = await getPrincipal()
  const principal = result.ok ? result.principal : undefined
  return principal?.kind === "token" ? { creatorUserId: principal.creatorUserId ?? null } : null
}
