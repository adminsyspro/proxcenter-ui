// src/app/api/v1/admin/sessions/route.ts
//
// Super-admin view of every live session in the installation, across every
// tenant. This intentionally reverses the "count only" boundary the sibling
// admin/users/[id]/sessions route documents: the author asked for a real
// listing (IP, device) after testing, restricted to super admins — a
// narrower audience than admin.users, because this is strictly broader
// visibility than that per-user revoke.
//
// Gated by requireSuperAdminCaller(), not checkPermission(ADMIN_USERS).
import { NextResponse } from "next/server"
import { getToken } from "next-auth/jwt"

import { prisma } from "@/lib/db/prisma"
import { sessionCookieName } from "@/lib/auth/cookies"
import { aliveWhere } from "@/lib/auth/sessions"
import { deviceLabel } from "@/lib/auth/deviceLabel"
import { requireSuperAdminCaller } from "@/lib/auth/totp-admin"

export const runtime = "nodejs"

// A hard cap, not a page size. The DataGrid only paginates client-side, so
// an unbounded query would fetch and serialise every live session in the
// installation in one response — exactly the moment this feature is most
// needed (an incident with unusually many open sessions) is when that would
// hurt most. Requesting one row past the cap tells us whether the true
// count exceeds it without a separate count query. Overflow must never be
// silent: a security listing that quietly drops rows is worse than no
// listing, because an admin who doesn't find what they're looking for will
// wrongly conclude it doesn't exist — see the `truncated` flag below.
const MAX_SESSION_ROWS = 500

// GET /api/v1/admin/sessions — every live session, newest activity first.
export async function GET(req: Request) {
  const denied = await requireSuperAdminCaller()
  if (denied) return denied

  // getServerSession's `session` callback deliberately does not carry `sid`
  // (lib/auth/config.ts) — reading the raw JWT is the only way to learn the
  // caller's own session row id, needed to mark `current` below. Same
  // pattern as /api/v1/auth/sessions/route.ts's currentSid().
  const token = await getToken({
    req: req as any,
    secret: process.env.NEXTAUTH_SECRET || "",
    cookieName: sessionCookieName(),
  })
  const callerSid = token?.sid ?? null

  const rows = await prisma.session.findMany({
    where: aliveWhere(),
    select: {
      id: true,
      userId: true,
      createdAt: true,
      lastSeenAt: true,
      ipAddress: true,
      userAgent: true,
      user: { select: { email: true, tenantId: true } },
    },
    orderBy: { lastSeenAt: "desc" },
    take: MAX_SESSION_ROWS + 1,
  })

  const truncated = rows.length > MAX_SESSION_ROWS
  const visibleRows = truncated ? rows.slice(0, MAX_SESSION_ROWS) : rows

  // User has no `tenant` relation in schema.prisma (only a scalar tenantId —
  // membership is the separate many-to-many UserTenant table), unlike
  // ApiToken's direct tenant: { select: { name: true } } join. Resolve names
  // in a second batched query instead, same pattern as
  // /api/v1/storage and /api/v1/rbac/assignments.
  const tenantIds = Array.from(new Set(visibleRows.map((row) => row.user.tenantId)))
  const tenants = tenantIds.length
    ? await prisma.tenant.findMany({ where: { id: { in: tenantIds } }, select: { id: true, name: true } })
    : []
  const tenantNameById = new Map(tenants.map((tenant) => [tenant.id, tenant.name]))

  const data = visibleRows.map((row) => {
    const { browser, os } = deviceLabel(row.userAgent)

    return {
      id: row.id,
      userId: row.userId,
      userEmail: row.user.email,
      tenantName: tenantNameById.get(row.user.tenantId) ?? row.user.tenantId,
      createdAt: row.createdAt.toISOString(),
      lastSeenAt: row.lastSeenAt.toISOString(),
      ipAddress: row.ipAddress,
      browser,
      os,
      // A token with no sid (pre-hardening token, or a failed row insert at
      // sign-in) marks every session as not-current rather than guessing.
      current: callerSid !== null && row.id === callerSid,
    }
  })

  return NextResponse.json({ data, truncated })
}
