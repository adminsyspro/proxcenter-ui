export const dynamic = "force-dynamic"
// src/app/api/v1/rbac/service-desk-assignments/route.ts
//
// Service-desk assignments (ui#1336): a provider user holds a service-desk
// role in every customer tenant the role is published to, or in a narrower
// list, without one assignment per tenant. Provider tenant only: a customer
// tenant never sees nor changes these.
import { NextRequest, NextResponse } from "next/server"

import { getServerSession } from "next-auth"
import { nanoid } from "nanoid"

import { authOptions } from "@/lib/auth/config"
import { audit } from "@/lib/audit"
import { withAudit } from "@/lib/audit/withAudit"
import { prisma } from "@/lib/db/prisma"
import { demoResponse } from "@/lib/demo/demo-api"
import { isUserProtected, isUserSuperAdmin, PERMISSIONS } from "@/lib/rbac"
import { roleHasSensitiveNicPermissions } from "@/lib/rbac/nicPermissions"
import { listCustomerTenantIds, parseServiceDeskTarget, syncServiceDeskAssignment } from "@/lib/rbac/serviceDesk"
import { assignmentSelect, parseExpiry, reachedTenants, toWire, type AssignmentRow } from "@/lib/rbac/serviceDeskApi"
import { requireProviderAdmin } from "@/lib/tenant/providerGuard"

// GET /api/v1/rbac/service-desk-assignments
export async function GET(req: NextRequest) {
  const demo = demoResponse(req)
  if (demo) return demo

  const denied = await requireProviderAdmin(PERMISSIONS.ADMIN_RBAC)
  if (denied) return denied

  const rows = (await prisma.rbacServiceDeskAssignment.findMany({
    select: assignmentSelect,
    orderBy: { grantedAt: "desc" },
  })) as AssignmentRow[]
  const reached = await reachedTenants(rows.map(r => r.id))
  return NextResponse.json({ data: rows.map(r => toWire(r, reached.get(r.id) ?? [])) })
}

// POST /api/v1/rbac/service-desk-assignments
async function handlePost(req: NextRequest) {
  const demo = demoResponse(req)
  if (demo) return demo

  const denied = await requireProviderAdmin(PERMISSIONS.ADMIN_RBAC)
  if (denied) return denied
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const body = await req.json()
  const userId = typeof body.user_id === "string" ? body.user_id : ""
  const roleId = typeof body.role_id === "string" ? body.role_id : ""
  if (!userId || !roleId) return NextResponse.json({ error: "user_id and role_id are required" }, { status: 400 })
  if (userId === session.user.id) {
    return NextResponse.json({ error: "You cannot change your own roles" }, { status: 400 })
  }

  const callerIsSuperAdmin = await isUserSuperAdmin(session.user.id)
  const [user, role] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true } }),
    prisma.rbacRole.findUnique({
      where: { id: roleId },
      select: {
        id: true,
        name: true,
        audience: true,
        publishAll: true,
        publications: { select: { tenantId: true } },
        permissions: { select: { permissionId: true } },
      },
    }),
  ])
  if (!user || (!callerIsSuperAdmin && (await isUserProtected(userId)))) {
    return NextResponse.json({ error: "User not found" }, { status: 404 })
  }
  if (role?.audience !== "service_desk") return NextResponse.json({ error: "Role not found" }, { status: 404 })
  if (!callerIsSuperAdmin && roleHasSensitiveNicPermissions(role)) {
    return NextResponse.json({ error: "Only a super admin may grant NIC identity permissions" }, { status: 403 })
  }

  const target = parseServiceDeskTarget(body, role, await listCustomerTenantIds())
  if (!target.ok) return NextResponse.json({ error: target.error }, { status: 400 })
  const expiry = parseExpiry(body.expires_at)
  if (!expiry.ok) return NextResponse.json({ error: "Invalid expires_at" }, { status: 400 })

  const existing = await prisma.rbacServiceDeskAssignment.findUnique({
    where: { userId_roleId: { userId, roleId } },
    select: { id: true },
  })
  if (existing) return NextResponse.json({ error: "This user already holds this service desk role" }, { status: 409 })

  const id = `sda_${nanoid(12)}`
  await prisma.rbacServiceDeskAssignment.create({
    data: {
      id,
      userId,
      roleId,
      allTenants: !!target.allTenants,
      tenantIds: target.tenantIds ?? [],
      grantedById: session.user.id,
      grantedAt: new Date(),
      expiresAt: expiry.value ?? null,
    },
  })
  const sync = await syncServiceDeskAssignment(id)

  await audit({
    action: "rbac_service_desk_assigned",
    category: "security",
    userId: session.user.id,
    userEmail: session.user.email,
    resourceType: "rbac_service_desk_assignment",
    resourceId: id,
    resourceName: `${user.email} → ${role.name}`,
    details: { role_id: roleId, user_id: userId, all_tenants: target.allTenants, tenant_ids: target.tenantIds, tenants: sync.added },
    status: "success",
  })

  const row = (await prisma.rbacServiceDeskAssignment.findUnique({ where: { id }, select: assignmentSelect })) as AssignmentRow
  const reached = await reachedTenants([id])
  return NextResponse.json({ data: toWire(row, reached.get(id) ?? []) }, { status: 201 })
}

export const POST = withAudit({ category: "security", resourceType: "rbac_service_desk_assignment" }, handlePost)
