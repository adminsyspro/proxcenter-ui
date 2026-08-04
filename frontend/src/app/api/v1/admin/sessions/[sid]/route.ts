// src/app/api/v1/admin/sessions/[sid]/route.ts
//
// Super-admin revoke of a single session, anywhere in the installation.
// The sibling DELETE /api/v1/admin/users/[id]/sessions revokes every
// session of one user and stays as it is; this route is per-session, which
// is what the new listing (GET /api/v1/admin/sessions) needs for its
// per-row revoke action.
//
// revokeSession(sid, userId) (@/lib/auth/sessions) is scoped to an owner, so
// the owning user must be resolved first.
import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"

import { authOptions } from "@/lib/auth/config"
import { prisma } from "@/lib/db/prisma"
import { audit } from "@/lib/audit"
import { revokeSession } from "@/lib/auth/sessions"
import { requireSuperAdminCaller } from "@/lib/auth/totp-admin"

export const runtime = "nodejs"

interface RouteContext {
  params: Promise<{ sid: string }>
}

// DELETE /api/v1/admin/sessions/[sid] — revoke one session. A sid that does
// not exist returns 404, never 403: matching
// DELETE /api/v1/auth/sessions/[sid]'s convention, a 403 would confirm the
// id is real. The audit entry names the owning user, never the sid.
export async function DELETE(_req: Request, ctx: RouteContext) {
  const denied = await requireSuperAdminCaller()
  if (denied) return denied

  const session = await getServerSession(authOptions)
  const { sid } = await ctx.params

  const target = await prisma.session.findUnique({
    where: { id: sid },
    select: { userId: true, user: { select: { email: true } } },
  })

  if (!target) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  const revoked = await revokeSession(sid, target.userId)

  if (!revoked) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  await audit({
    action: "session_revoked_single",
    category: "auth",
    userId: session?.user?.id,
    userEmail: session?.user?.email ?? undefined,
    resourceType: "user",
    resourceId: target.userId,
    resourceName: target.user.email,
    status: "success",
    details: { by: "admin" },
  })

  return NextResponse.json({ data: { ok: true } })
}
