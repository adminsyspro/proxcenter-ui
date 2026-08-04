// src/app/api/v1/auth/sessions/[sid]/route.ts
//
// Revoke one of the caller's own sessions. Scoped entirely to session.user.id
// — there is no admin path here (that's a separate route with its own
// permission check).
export const runtime = "nodejs"

import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"

import { authOptions } from "@/lib/auth/config"
import { revokeSession } from "@/lib/auth/sessions"

interface RouteContext {
  params: Promise<{ sid: string }>
}

// DELETE /api/v1/auth/sessions/[sid] — revoke a single session belonging to
// the caller. revokeSession scopes its update to (id, userId), so a sid that
// belongs to another user updates zero rows exactly like a sid that doesn't
// exist. Both cases return 404, never 403: a 403 would confirm the sid is
// real, leaking whether a given session id exists.
export async function DELETE(req: Request, context: RouteContext) {
  const session = await getServerSession(authOptions)

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const { sid } = await context.params

  const revoked = await revokeSession(sid, session.user.id)

  if (!revoked) {
    return NextResponse.json({ error: "Not found" }, { status: 404 })
  }

  return NextResponse.json({ data: { ok: true } })
}
