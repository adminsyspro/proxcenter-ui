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

  const target = await prisma.user.findUnique({
    where: { id: targetId },
    select: { email: true },
  })

  if (!target) {
    return NextResponse.json({ error: "User not found" }, { status: 404 })
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
