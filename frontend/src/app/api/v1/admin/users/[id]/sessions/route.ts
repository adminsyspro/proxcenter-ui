// src/app/api/v1/admin/users/[id]/sessions/route.ts
//
// Admin bulk revoke: cut every session of the target user right now.
//
// Guarded by checkPermission(PERMISSIONS.ADMIN_USERS) — the same permission
// the user-management routes already require — not requireSuperAdminCaller
// (used by the sibling 2FA admin routes). PATCH /api/v1/users/[id] already
// revokes every session of a user as a side effect of disabling the account,
// gated behind that same admin.users permission, so requiring super-admin
// here would be strictly more restrictive than an existing route that
// produces the same effect.
//
// That permission check alone only proves the caller holds admin.users
// somewhere — it says nothing about which target user they may act on. Every
// handler in the sibling `users/[id]/route.ts` (GET/PATCH/DELETE) layers two
// more checks on top of it, in this order:
//   1. denyIfTargetIsProtectedAndCallerIsNot — a tenant-scoped admin must
//      never reach a super_admin/provider_admin target.
//   2. tenant resolution + membership (findUserInTenant), bypassed entirely
//      from the provider view (default tenant) — a tenant-scoped admin must
//      never reach a user outside their own tenant.
// This route applies the exact same two checks, in the exact same order,
// via the shared @/lib/rbac/userTargetGuards module (see that file for why
// they're shared rather than duplicated).
//
// The admin surface is deliberately limited to a count and this revoke
// action: no IP addresses, no device labels, no per-session timestamps for
// other users, and no listing endpoint. The response body must never carry
// ipAddress or userAgent, and the audit entry never identifies a session.
import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"

import { authOptions } from "@/lib/auth/config"
import { prisma } from "@/lib/db/prisma"
import { audit } from "@/lib/audit"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { denyIfTargetIsProtectedAndCallerIsNot, findUserInTenant } from "@/lib/rbac/userTargetGuards"
import { DEFAULT_TENANT_ID, getCurrentTenantId } from "@/lib/tenant"
import { revokeAllSessions } from "@/lib/auth/sessions"

export const runtime = "nodejs"

// DELETE /api/v1/admin/users/[id]/sessions — revoke every session of the
// target user. The target may be the caller themselves: that is allowed and
// simply logs them out too, same as disabling one's own account would.
export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const denied = await checkPermission(PERMISSIONS.ADMIN_USERS)
  if (denied) return denied

  const session = await getServerSession(authOptions)
  const { id: targetId } = await ctx.params

  const superAdminBlock = await denyIfTargetIsProtectedAndCallerIsNot(targetId, session?.user?.id)
  if (superAdminBlock) return superAdminBlock

  const tenantId = await getCurrentTenantId()
  const isProviderView = tenantId === DEFAULT_TENANT_ID

  // Provider view (default tenant) can target any user, including those
  // with no membership in `default` — mirrors GET/PATCH/DELETE
  // /api/v1/users/[id]. Tenant-scoped callers stay pinned to their own
  // tenant's memberships so they can't reach a user in another tenant by
  // guessing an id.
  const target = isProviderView
    ? await prisma.user.findUnique({ where: { id: targetId } })
    : await findUserInTenant(targetId, tenantId)

  if (!target) {
    return NextResponse.json({ error: "Utilisateur non trouvé" }, { status: 404 })
  }

  // No exception sid: every session of the target dies, unlike the
  // self-service DELETE /api/v1/auth/sessions which spares the caller's own.
  const revoked = await revokeAllSessions(targetId)

  await audit({
    action: "sessions_revoked",
    category: "auth",
    userId: session?.user?.id,
    userEmail: session?.user?.email ?? undefined,
    resourceType: "user",
    resourceId: targetId,
    resourceName: target.email,
    status: "success",
    details: { by: "admin", revoked },
  })

  return NextResponse.json({ data: { revoked } })
}
