export const dynamic = "force-dynamic"
// src/app/api/v1/rbac/assignments/[id]/route.ts
import { NextResponse } from "next/server"

import { authorizeAdminRead, authorizeAdminWrite, ownRolesError } from "@/lib/auth/actingUser"
import { prisma } from "@/lib/db/prisma"
import { audit } from "@/lib/audit"
import { isUserSuperAdmin, isUserProtected, PERMISSIONS, PROTECTED_ROLE_IDS } from "@/lib/rbac"
import { guardRoleAssignment } from "@/lib/rbac/assignmentGuards"
import { canReadRoleAssignments } from "@/lib/rbac/assignmentReadAccess"
import { isServiceDeskManaged } from "@/lib/rbac/serviceDesk"
import { roleHasSensitiveNicPermissions } from "@/lib/rbac/nicPermissions"
import { scopeIncludes, validateAssignmentScope } from "@/lib/rbac/scope-validation"
import { DEFAULT_TENANT_ID, getCurrentTenantId } from "@/lib/tenant"
import { demoResponse } from "@/lib/demo/demo-api"
import { withAudit } from "@/lib/audit/withAudit"
import { withPublicApiGuard } from "@/lib/api-tokens/routeGuard"

/**
 * Build the `where` clause for a single-assignment lookup. Provider-tenant
 * callers ({@link DEFAULT_TENANT_ID}) reach assignments in every tenant — this
 * mirrors the GET list endpoint and lets /security/rbac edit / delete the
 * per-tenant rows it surfaces in provider view. Tenant-scoped operators stay
 * pinned to their own tenant so they can't touch assignments outside scope.
 */
function buildAssignmentWhere(id: string, sessionTenantId: string) {
  return sessionTenantId === DEFAULT_TENANT_ID ? { id } : { id, tenantId: sessionTenantId }
}

interface RouteContext {
  params: Promise<{ id: string }>
}

/**
 * 404 non-super-admin callers when the assignment (or its target user) is
 * associated with a protected role (super_admin + provider_admin). Prevents
 * tenant admins from touching provider-level operators via the assignments
 * API.
 */
async function denyIfAssignmentTouchesProtected(
  assignment: { roleId: string; userId: string } | null,
  callerUserId: string | undefined
): Promise<NextResponse | null> {
  if (!assignment) return null
  if (callerUserId && (await isUserSuperAdmin(callerUserId))) return null
  if (
    (PROTECTED_ROLE_IDS as readonly string[]).includes(assignment.roleId) ||
    (await isUserProtected(assignment.userId))
  ) {
    return NextResponse.json({ error: "Assignment not found" }, { status: 404 })
  }
  return null
}

// GET /api/v1/rbac/assignments/[id] - Détails d'une assignation
async function handleGet(req: Request, context: RouteContext) {
  const demo = demoResponse(req)
  if (demo) return demo

  try {
    const reader = await authorizeAdminRead(PERMISSIONS.ADMIN_RBAC_VIEW)
    if (reader.denied) return reader.denied

    const { id } = await context.params
    const tenantId = await getCurrentTenantId()

    const assignment = await prisma.rbacUserRole.findFirst({
      where: buildAssignmentWhere(id, tenantId),
      include: {
        user: { select: { id: true, email: true, name: true } },
        role: { select: { id: true, name: true, color: true } },
        grantedBy: { select: { email: true } },
      },
    })

    // Without admin.users or admin.rbac (or their .view), the caller's own
    // assignments only (roadmap#223); a token reached this line through
    // admin.rbac.view.
    const selfId = reader.userId
    if (!assignment || (selfId && assignment.userId !== selfId && !(await canReadRoleAssignments(selfId, tenantId)))) {
      return NextResponse.json({ error: "Assignment not found" }, { status: 404 })
    }

    const superAdminBlock = await denyIfAssignmentTouchesProtected(
      { roleId: assignment.roleId, userId: assignment.userId },
      reader.userId,
    )
    if (superAdminBlock) return superAdminBlock

    return NextResponse.json({
      data: {
        id: assignment.id,
        user_id: assignment.userId,
        role_id: assignment.roleId,
        scope_type: assignment.scopeType,
        scope_target: assignment.scopeTarget,
        tenant_id: assignment.tenantId,
        granted_by: assignment.grantedById,
        granted_at: assignment.grantedAt.toISOString(),
        expires_at: assignment.expiresAt?.toISOString() ?? null,
        user_email: assignment.user.email,
        user_name: assignment.user.name,
        role_name: assignment.role.name,
        role_color: assignment.role.color,
        granted_by_email: assignment.grantedBy?.email ?? null,
      }
    })

  } catch (error: any) {
    console.error("GET /api/v1/rbac/assignments/[id] error:", error)

return NextResponse.json(
      { error: error.message || "Server error" },
      { status: 500 }
    )
  }
}

export const GET = withPublicApiGuard("rbac-assignment-get", handleGet)

// DELETE /api/v1/rbac/assignments/[id] - Supprimer une assignation
async function handleDelete(req: Request, context: RouteContext) {
  const demo = demoResponse(req)
  if (demo) return demo

  try {
    // A session needs admin.rbac in its tenant; a token needs it from its
    // rbac:write scope and never acts as a super admin.
    const writer = await authorizeAdminWrite("admin.rbac")
    if (writer.denied) return writer.denied

    const tenantId = await getCurrentTenantId()

    const { id } = await context.params

    // Récupérer l'assignation pour l'audit (scoped by tenant)
    const assignment = await prisma.rbacUserRole.findFirst({
      where: buildAssignmentWhere(id, tenantId),
      include: {
        user: { select: { email: true } },
        role: { select: { name: true, audience: true } },
      },
    })

    if (!assignment) {
      return NextResponse.json({ error: "Assignment not found" }, { status: 404 })
    }

    // A provider service-desk row (ui#1336) is changed or revoked by the
    // provider: from its service desk assignment, or from its SSO mapping.
    if (isServiceDeskManaged(assignment, tenantId)) {
      return NextResponse.json(
        { error: "This assignment is managed by the provider service desk", code: "SERVICE_DESK_MANAGED" },
        { status: 409 },
      )
    }

    const superAdminBlock = await denyIfAssignmentTouchesProtected(
      { roleId: assignment.roleId, userId: assignment.userId },
      writer.userId,
    )
    if (superAdminBlock) return superAdminBlock

    // Prevent self-lockout: nobody may revoke their own role.
    if (assignment.userId === writer.selfUserId) {
      return NextResponse.json({ error: ownRolesError(writer, "revoke") }, { status: 400 })
    }

    // Supprimer l'assignation
    await prisma.rbacUserRole.deleteMany({ where: buildAssignmentWhere(id, tenantId) })

    // Audit
    await audit({
      action: "rbac_role_revoked",
      category: "security",
      userId: writer.userId,
      userEmail: writer.userEmail,
      resourceType: "user",
      resourceId: assignment.userId,
      resourceName: assignment.user.email,
      details: {
        role_name: assignment.role.name,
        role_id: assignment.roleId,
        scope_type: assignment.scopeType,
        scope_target: assignment.scopeTarget,
      },
      status: "success"
    })

    return NextResponse.json({ success: true })

  } catch (error: any) {
    console.error("DELETE /api/v1/rbac/assignments/[id] error:", error)

return NextResponse.json(
      { error: error.message || "Server error" },
      { status: 500 }
    )
  }
}

// PATCH /api/v1/rbac/assignments/[id] - Modifier une assignation
async function handlePatch(req: Request, context: RouteContext) {
  const demo = demoResponse(req)
  if (demo) return demo

  try {
    // A session needs admin.rbac in its tenant; a token needs it from its
    // rbac:write scope and never acts as a super admin.
    const writer = await authorizeAdminWrite("admin.rbac")
    if (writer.denied) return writer.denied

    const tenantId = await getCurrentTenantId()

    const { id } = await context.params
    const body = await req.json()
    const { role_id, scope_type, scope_target, expires_at } = body

    // Récupérer l'assignation existante (scoped by tenant)
    const assignment = await prisma.rbacUserRole.findFirst({
      where: buildAssignmentWhere(id, tenantId),
      include: {
        user: { select: { email: true } },
        role: { select: { name: true, audience: true, permissions: { select: { permissionId: true } } } },
      },
    })

    if (!assignment) {
      return NextResponse.json({ error: "Assignment not found" }, { status: 404 })
    }

    // A provider service-desk row (ui#1336) is changed or revoked by the
    // provider: from its service desk assignment, or from its SSO mapping.
    if (isServiceDeskManaged(assignment, tenantId)) {
      return NextResponse.json(
        { error: "This assignment is managed by the provider service desk", code: "SERVICE_DESK_MANAGED" },
        { status: 409 },
      )
    }

    const superAdminBlock = await denyIfAssignmentTouchesProtected(
      { roleId: assignment.roleId, userId: assignment.userId },
      writer.userId,
    )
    if (superAdminBlock) return superAdminBlock

    // Prevent self-escalation: nobody may change their own role assignment.
    if (assignment.userId === writer.selfUserId) {
      return NextResponse.json({ error: ownRolesError(writer, "change") }, { status: 400 })
    }

    // A new role obeys the rules of every grant (lib/rbac/assignmentGuards.ts),
    // evaluated in the tenant of the assignment being changed.
    const callerIsSuperAdmin = writer.userId ? await isUserSuperAdmin(writer.userId) : false
    if (role_id !== undefined) {
      const guard = await guardRoleAssignment({
        callerUserId: writer.userId ?? "",
        roleId: role_id,
        targetTenantId: assignment.tenantId,
      })
      if (!guard.ok) return guard.response!
    }

    // The scope this request results in, whatever fields it names: a target
    // sent alone keeps the type, a type sent alone keeps the target
    // ("inherit"/"global" drop it). Validated as a whole, so a partial body
    // obeys the same rules as a full one.
    const current = { scopeType: assignment.scopeType, scopeTarget: assignment.scopeTarget ?? null }
    let nextScope: { scopeType: string; scopeTarget: string | null } | null = null
    if (scope_type !== undefined || scope_target !== undefined) {
      const check = validateAssignmentScope(
        scope_type ?? current.scopeType,
        scope_target !== undefined ? scope_target : current.scopeTarget,
      )
      if (!check.ok) {
        return NextResponse.json({ error: check.error }, { status: 400 })
      }
      nextScope = { scopeType: check.scopeType!, scopeTarget: check.scopeTarget ?? null }
    }
    const scopeMoves = nextScope !== null
      && (nextScope.scopeType !== current.scopeType || nextScope.scopeTarget !== current.scopeTarget)

    // A provider admin may still narrow an existing NIC identity grant inside
    // its current scope, or expire it; widening it or moving it to another
    // resource stays reserved to a super admin.
    if (!callerIsSuperAdmin && roleHasSensitiveNicPermissions(assignment.role) && scopeMoves
      && !scopeIncludes(current, nextScope!)) {
      return NextResponse.json({ error: 'Only a super admin may widen or move a NIC identity grant' }, { status: 403 })
    }

    // Construire le payload Prisma en ne touchant que les champs fournis
    const data: Record<string, unknown> = {}

    if (role_id !== undefined) {
      data.roleId = role_id
    }

    if (nextScope) {
      data.scopeType = nextScope.scopeType
      data.scopeTarget = nextScope.scopeTarget
    }

    if (expires_at !== undefined) {
      data.expiresAt = expires_at ? new Date(expires_at) : null
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "No fields to update" }, { status: 400 })
    }

    await prisma.rbacUserRole.updateMany({ where: buildAssignmentWhere(id, tenantId), data })

    // Récupérer l'assignation mise à jour
    const updated = await prisma.rbacUserRole.findFirst({
      where: buildAssignmentWhere(id, tenantId),
      include: {
        user: { select: { id: true, email: true } },
        role: { select: { id: true, name: true, color: true } },
      },
    })

    if (!updated) {
      return NextResponse.json({ error: "Assignment not found" }, { status: 404 })
    }

    // Audit
    await audit({
      action: "rbac_assignment_updated",
      category: "security",
      userId: writer.userId,
      userEmail: writer.userEmail,
      resourceType: "user",
      resourceId: assignment.userId,
      resourceName: assignment.user.email,
      details: {
        old_role: assignment.role.name,
        new_role: updated.role.name,
        old_scope_type: assignment.scopeType,
        new_scope_type: updated.scopeType,
        old_scope_target: assignment.scopeTarget,
        new_scope_target: updated.scopeTarget,
      },
      status: "success"
    })

    return NextResponse.json({
      data: {
        id: updated.id,
        user: {
          id: updated.user.id,
          email: updated.user.email,
        },
        role: {
          id: updated.role.id,
          name: updated.role.name,
          color: updated.role.color,
        },
        scope_type: updated.scopeType,
        scope_target: updated.scopeTarget,
        expires_at: updated.expiresAt?.toISOString() ?? null,
      },
    })

  } catch (error: any) {
    console.error("PATCH /api/v1/rbac/assignments/[id] error:", error)

return NextResponse.json(
      { error: error.message || "Server error" },
      { status: 500 }
    )
  }
}

export const DELETE = withAudit({ category: "security", resourceType: "assignment", resourceParam: "id" }, withPublicApiGuard("rbac-assignment-delete", handleDelete))
export const PATCH = withAudit({ category: "security", resourceType: "assignment", resourceParam: "id" }, withPublicApiGuard("rbac-assignment-update", handlePatch))
