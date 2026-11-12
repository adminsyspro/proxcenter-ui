// The signed-in user acting on a request, for attribution (createdBy, audit
// rows) and super-admin checks. Resolved through getPrincipal, the one module
// allowed to read the session, so a route reachable by API tokens never reads
// it on its own (issue #1360). A token carries no user: null, as for an
// anonymous caller.
import { NextResponse } from "next/server"

import { getPrincipal } from "@/lib/auth/principal"
import { checkPermission, getRBACContext } from "@/lib/rbac"

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
