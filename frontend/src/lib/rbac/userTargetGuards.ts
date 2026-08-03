// src/lib/rbac/userTargetGuards.ts
//
// Shared authorization guards for any admin route that acts on a specific
// target user id after `checkPermission(PERMISSIONS.ADMIN_USERS)` passes.
// That permission check alone only proves the caller holds admin.users
// somewhere — it says nothing about which target user they may act on, so
// every route touching a target id layers these two rules on top of it:
//
//   1. denyIfTargetIsProtectedAndCallerIsNot — a tenant-scoped admin must
//      never be able to act on a super_admin/provider_admin account.
//   2. findUserInTenant (+ the provider-view bypass callers apply around
//      it) — a tenant-scoped admin must never reach a user outside their
//      own tenant.
//
// Originally three private copies inside users/[id]/route.ts (GET, PATCH,
// DELETE each called the same two checks). Extracted here so every route
// enforcing "admin acting on a target user" — including
// admin/users/[id]/sessions — shares one implementation instead of
// re-deriving an authorization rule that could drift between copies.
import { NextResponse } from "next/server"

import { prisma } from "@/lib/db/prisma"
import { isUserProtected, isUserSuperAdmin } from "@/lib/rbac"

/**
 * Hide provider-level accounts (super_admin + provider_admin) from
 * non-super-admin callers. Returns 404 rather than 403 so existence is not
 * leaked.
 */
export async function denyIfTargetIsProtectedAndCallerIsNot(
  targetUserId: string,
  callerUserId: string | undefined
): Promise<NextResponse | null> {
  if (!(await isUserProtected(targetUserId))) return null
  if (callerUserId && (await isUserSuperAdmin(callerUserId))) return null
  return NextResponse.json({ error: "Utilisateur non trouvé" }, { status: 404 })
}

/**
 * Fetch a user that belongs to the given tenant. Returns the full Prisma row
 * or null if the user doesn't exist or has no membership in this tenant.
 * Centralised so every route scoping a target user to the caller's tenant
 * uses the same lookup rule.
 */
export async function findUserInTenant(userId: string, tenantId: string) {
  const membership = await prisma.userTenant.findUnique({
    where: { userId_tenantId: { userId, tenantId } },
    include: { user: true },
  })
  return membership?.user ?? null
}
