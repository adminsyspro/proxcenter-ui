// src/app/api/v1/auth/sessions/route.ts
//
// Self-service session listing and bulk revocation. Scoped entirely to the
// caller: every query below runs against session.user.id, and there is no
// parameter to act on anyone else's sessions. The admin equivalent is a
// separate route with its own permission check.
export const runtime = "nodejs"

import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { getToken } from "next-auth/jwt"

import { authOptions } from "@/lib/auth/config"
import { sessionCookieName } from "@/lib/auth/cookies"
import { deviceLabel } from "@/lib/auth/deviceLabel"
import { listSessions, revokeAllSessions } from "@/lib/auth/sessions"

// getServerSession's `session` callback deliberately does not carry `sid`
// (lib/auth/config.ts) — reading the raw JWT is the only way to learn the
// caller's own session row id, needed to mark `current` below.
async function currentSid(req: Request): Promise<string | null> {
  const token = await getToken({
    req: req as any,
    secret: process.env.NEXTAUTH_SECRET || "",
    cookieName: sessionCookieName(),
  })

  return token?.sid ?? null
}

// GET /api/v1/auth/sessions — the caller's own live sessions.
export async function GET(req: Request) {
  const session = await getServerSession(authOptions)

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const sid = await currentSid(req)
  const rows = await listSessions(session.user.id)

  const data = rows.map((row) => {
    const { browser, os } = deviceLabel(row.userAgent)

    return {
      id: row.id,
      // A token with no sid (pre-hardening token, or a failed row insert at
      // sign-in) marks every session as not-current rather than guessing.
      current: sid !== null && row.id === sid,
      browser,
      os,
      userAgent: row.userAgent,
      ipAddress: row.ipAddress,
      createdAt: row.createdAt.toISOString(),
      lastSeenAt: row.lastSeenAt.toISOString(),
    }
  })

  return NextResponse.json({ data })
}

// DELETE /api/v1/auth/sessions — revoke all of the caller's sessions except
// the one making this request. Excluding the current session is deliberate:
// a single click must not log the user out of the screen they are on.
export async function DELETE(req: Request) {
  const session = await getServerSession(authOptions)

  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const sid = await currentSid(req)
  const revoked = await revokeAllSessions(session.user.id, sid)

  return NextResponse.json({ data: { revoked } })
}
