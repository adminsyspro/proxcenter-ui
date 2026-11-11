export const dynamic = "force-dynamic"
// src/app/api/v1/rbac/service-desk-assignments/[id]/route.ts
//
// Change the tenant target or the expiry of a service-desk assignment, or
// revoke it (ui#1336). Provider tenant only.
import { NextRequest, NextResponse } from "next/server"

import { getServerSession } from "next-auth"

import { authOptions } from "@/lib/auth/config"
import { audit } from "@/lib/audit"
import { withAudit } from "@/lib/audit/withAudit"
import { prisma } from "@/lib/db/prisma"
import { demoResponse } from "@/lib/demo/demo-api"
import { isUserProtected, isUserSuperAdmin, PERMISSIONS } from "@/lib/rbac"
import { roleHasSensitiveNicPermissions } from "@/lib/rbac/nicPermissions"
import {
  computeServiceDeskTargets,
  listCustomerTenantIds,
  parseServiceDeskTarget,
  SERVICE_DESK_ROW_PREFIX,
  syncServiceDeskAssignment,
} from "@/lib/rbac/serviceDesk"
import { assignmentSelect, parseExpiry, reachedTenants, toWire, type AssignmentRow } from "@/lib/rbac/serviceDeskApi"
import { requireProviderAdmin } from "@/lib/tenant/providerGuard"

interface RouteContext {
  params: Promise<{ id: string }>
}

/** The assignment, unless its holder is a protected account the caller may not touch. */
async function loadForCaller(id: string, callerUserId: string) {
  const row = await prisma.rbacServiceDeskAssignment.findUnique({
    where: { id },
    select: {
      id: true,
      userId: true,
      roleId: true,
      allTenants: true,
      tenantIds: true,
      expiresAt: true,
      user: { select: { email: true } },
      role: {
        select: {
          name: true,
          audience: true,
          publishAll: true,
          publications: { select: { tenantId: true } },
          permissions: { select: { permissionId: true } },
        },
      },
    },
  })
  if (!row) return null
  if (row.userId === callerUserId) return null
  if (!(await isUserSuperAdmin(callerUserId)) && (await isUserProtected(row.userId))) return null
  return row
}

// PATCH /api/v1/rbac/service-desk-assignments/[id]
async function handlePatch(req: NextRequest, context: RouteContext) {
  const demo = demoResponse(req)
  if (demo) return demo

  const denied = await requireProviderAdmin(PERMISSIONS.ADMIN_RBAC)
  if (denied) return denied
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await context.params
  const current = await loadForCaller(id, session.user.id)
  if (!current) return NextResponse.json({ error: "Assignment not found" }, { status: 404 })

  const body = await req.json()
  const customerTenantIds = await listCustomerTenantIds()
  const touchesTarget = body.all_tenants !== undefined || body.tenant_ids !== undefined
  const target = touchesTarget
    ? parseServiceDeskTarget(
        {
          all_tenants: body.all_tenants === undefined ? current.allTenants : body.all_tenants,
          tenant_ids: body.tenant_ids === undefined ? current.tenantIds : body.tenant_ids,
        },
        current.role,
        customerTenantIds,
      )
    : { ok: true, allTenants: current.allTenants, tenantIds: current.tenantIds }
  if (!target.ok) return NextResponse.json({ error: target.error }, { status: 400 })
  const expiry = body.expires_at === undefined ? { ok: true, value: current.expiresAt } : parseExpiry(body.expires_at)
  if (!expiry.ok) return NextResponse.json({ error: "Invalid expires_at" }, { status: 400 })

  // Same rule as PATCH /rbac/assignments/[id]: a provider admin may narrow or
  // expire a NIC identity grant, widening it to another tenant stays reserved
  // to a super admin.
  if (touchesTarget && roleHasSensitiveNicPermissions(current.role) && !(await isUserSuperAdmin(session.user.id))) {
    const reached = await prisma.rbacUserRole.findMany({
      where: { id: { startsWith: `${SERVICE_DESK_ROW_PREFIX}${id}_` } },
      select: { tenantId: true },
    })
    const reachedNow = new Set(reached.map(r => r.tenantId))
    const next = computeServiceDeskTargets({
      assignment: { allTenants: !!target.allTenants, tenantIds: target.tenantIds ?? [], expiresAt: null },
      role: current.role,
      customerTenantIds,
      now: new Date(),
    })
    if (next.some(tenantId => !reachedNow.has(tenantId))) {
      return NextResponse.json({ error: "Only a super admin may widen a NIC identity grant" }, { status: 403 })
    }
  }

  await prisma.rbacServiceDeskAssignment.update({
    where: { id },
    data: { allTenants: !!target.allTenants, tenantIds: target.tenantIds ?? [], expiresAt: expiry.value ?? null },
  })
  const sync = await syncServiceDeskAssignment(id)

  await audit({
    action: "rbac_service_desk_updated",
    category: "security",
    userId: session.user.id,
    userEmail: session.user.email,
    resourceType: "rbac_service_desk_assignment",
    resourceId: id,
    resourceName: `${current.user.email} → ${current.role.name}`,
    details: {
      all_tenants: target.allTenants,
      tenant_ids: target.tenantIds,
      expires_at: expiry.value?.toISOString() ?? null,
      tenants_added: sync.added,
      tenants_removed: sync.removed,
    },
    status: "success",
  })

  const row = (await prisma.rbacServiceDeskAssignment.findUnique({ where: { id }, select: assignmentSelect })) as AssignmentRow
  const reached = await reachedTenants([id])
  return NextResponse.json({ data: toWire(row, reached.get(id) ?? []) })
}

// DELETE /api/v1/rbac/service-desk-assignments/[id]
async function handleDelete(req: NextRequest, context: RouteContext) {
  const demo = demoResponse(req)
  if (demo) return demo

  const denied = await requireProviderAdmin(PERMISSIONS.ADMIN_RBAC)
  if (denied) return denied
  const session = await getServerSession(authOptions)
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 })

  const { id } = await context.params
  const current = await loadForCaller(id, session.user.id)
  if (!current) return NextResponse.json({ error: "Assignment not found" }, { status: 404 })

  await prisma.rbacServiceDeskAssignment.delete({ where: { id } })
  // The assignment is gone: the sync removes every row and membership it owned.
  const sync = await syncServiceDeskAssignment(id)

  await audit({
    action: "rbac_service_desk_revoked",
    category: "security",
    userId: session.user.id,
    userEmail: session.user.email,
    resourceType: "rbac_service_desk_assignment",
    resourceId: id,
    resourceName: `${current.user.email} → ${current.role.name}`,
    details: { tenants_removed: sync.removed },
    status: "success",
  })

  return NextResponse.json({ success: true })
}

export const PATCH = withAudit({ category: "security", resourceType: "rbac_service_desk_assignment", resourceParam: "id" }, handlePatch)
export const DELETE = withAudit({ category: "security", resourceType: "rbac_service_desk_assignment", resourceParam: "id" }, handleDelete)
