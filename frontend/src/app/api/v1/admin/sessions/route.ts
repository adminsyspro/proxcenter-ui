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

import { prisma } from "@/lib/db/prisma"
import { aliveWhere } from "@/lib/auth/sessions"
import { deviceLabel } from "@/lib/auth/deviceLabel"
import { requireSuperAdminCaller } from "@/lib/auth/totp-admin"

export const runtime = "nodejs"

// GET /api/v1/admin/sessions — every live session, newest activity first.
export async function GET() {
  const denied = await requireSuperAdminCaller()
  if (denied) return denied

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
  })

  // User has no `tenant` relation in schema.prisma (only a scalar tenantId —
  // membership is the separate many-to-many UserTenant table), unlike
  // ApiToken's direct tenant: { select: { name: true } } join. Resolve names
  // in a second batched query instead, same pattern as
  // /api/v1/storage and /api/v1/rbac/assignments.
  const tenantIds = Array.from(new Set(rows.map((row) => row.user.tenantId)))
  const tenants = tenantIds.length
    ? await prisma.tenant.findMany({ where: { id: { in: tenantIds } }, select: { id: true, name: true } })
    : []
  const tenantNameById = new Map(tenants.map((tenant) => [tenant.id, tenant.name]))

  const data = rows.map((row) => {
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
    }
  })

  return NextResponse.json({ data })
}
