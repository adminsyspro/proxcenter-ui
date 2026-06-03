export const dynamic = "force-dynamic"
// src/app/api/v1/rbac/assignments/[id]/route.ts
import { NextRequest, NextResponse } from "next/server"

import { getServerSession } from "next-auth"

import { authOptions } from "@/lib/auth/config"
import { prisma } from "@/lib/db/prisma"
import { audit } from "@/lib/audit"
import { hasPermission, isUserSuperAdmin, isUserProtected, PROTECTED_ROLE_IDS, PROVIDER_ONLY_ROLE_IDS } from "@/lib/rbac"
import { validateAssignmentScope } from "@/lib/rbac/scope-validation"
import { DEFAULT_TENANT_ID, getCurrentTenantId } from "@/lib/tenant"
import { demoResponse } from "@/lib/demo/demo-api"

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
  callerUserId: string
): Promise<NextResponse | null> {
  if (!assignment) return null
  if (await isUserSuperAdmin(callerUserId)) return null
  if (
    (PROTECTED_ROLE_IDS as readonly string[]).includes(assignment.roleId) ||
    (await isUserProtected(assignment.userId))
  ) {
    return NextResponse.json({ error: "Assignation non trouvée" }, { status: 404 })
  }
  return null
}

// GET /api/v1/rbac/assignments/[id] - Détails d'une assignation
export async function GET(req: NextRequest, context: RouteContext) {
  const demo = demoResponse(req)
  if (demo) return demo

  try {
    const session = await getServerSession(authOptions)

    if (!session?.user) {
      return NextResponse.json({ error: "Non autorisé" }, { status: 401 })
    }

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

    if (!assignment) {
      return NextResponse.json({ error: "Assignation non trouvée" }, { status: 404 })
    }

    const superAdminBlock = await denyIfAssignmentTouchesProtected(
      { roleId: assignment.roleId, userId: assignment.userId },
      session.user.id,
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
      { error: error.message || "Erreur serveur" },
      { status: 500 }
    )
  }
}

// DELETE /api/v1/rbac/assignments/[id] - Supprimer une assignation
export async function DELETE(req: NextRequest, context: RouteContext) {
  const demo = demoResponse(req)
  if (demo) return demo

  try {
    const session = await getServerSession(authOptions)

    if (!session?.user) {
      return NextResponse.json({ error: "Non autorisé" }, { status: 401 })
    }

    const tenantId = await getCurrentTenantId()

    if (!(await hasPermission({ userId: session.user.id, permission: "admin.rbac", tenantId }))) {
      return NextResponse.json({ error: "Droits administrateur requis" }, { status: 403 })
    }

    const { id } = await context.params

    // Récupérer l'assignation pour l'audit (scoped by tenant)
    const assignment = await prisma.rbacUserRole.findFirst({
      where: buildAssignmentWhere(id, tenantId),
      include: {
        user: { select: { email: true } },
        role: { select: { name: true } },
      },
    })

    if (!assignment) {
      return NextResponse.json({ error: "Assignation non trouvée" }, { status: 404 })
    }

    const superAdminBlock = await denyIfAssignmentTouchesProtected(
      { roleId: assignment.roleId, userId: assignment.userId },
      session.user.id,
    )
    if (superAdminBlock) return superAdminBlock

    // Prevent self-lockout: nobody may revoke their own role.
    if (assignment.userId === session.user.id) {
      return NextResponse.json(
        { error: "Vous ne pouvez pas révoquer vos propres rôles" },
        { status: 400 }
      )
    }

    // Supprimer l'assignation
    await prisma.rbacUserRole.deleteMany({ where: buildAssignmentWhere(id, tenantId) })

    // Audit
    await audit({
      action: "rbac_role_revoked",
      category: "security",
      userId: session.user.id,
      userEmail: session.user.email,
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
      { error: error.message || "Erreur serveur" },
      { status: 500 }
    )
  }
}

// PATCH /api/v1/rbac/assignments/[id] - Modifier une assignation
export async function PATCH(req: NextRequest, context: RouteContext) {
  const demo = demoResponse(req)
  if (demo) return demo

  try {
    const session = await getServerSession(authOptions)

    if (!session?.user) {
      return NextResponse.json({ error: "Non autorisé" }, { status: 401 })
    }

    const tenantId = await getCurrentTenantId()

    if (!(await hasPermission({ userId: session.user.id, permission: "admin.rbac", tenantId }))) {
      return NextResponse.json({ error: "Droits administrateur requis" }, { status: 403 })
    }

    const { id } = await context.params
    const body = await req.json()
    const { role_id, scope_type, scope_target, expires_at } = body

    // Récupérer l'assignation existante (scoped by tenant)
    const assignment = await prisma.rbacUserRole.findFirst({
      where: buildAssignmentWhere(id, tenantId),
      include: {
        user: { select: { email: true } },
        role: { select: { name: true } },
      },
    })

    if (!assignment) {
      return NextResponse.json({ error: "Assignation non trouvée" }, { status: 404 })
    }

    const superAdminBlock = await denyIfAssignmentTouchesProtected(
      { roleId: assignment.roleId, userId: assignment.userId },
      session.user.id,
    )
    if (superAdminBlock) return superAdminBlock

    // Prevent self-escalation: nobody may change their own role assignment.
    if (assignment.userId === session.user.id) {
      return NextResponse.json(
        { error: "Vous ne pouvez pas modifier vos propres rôles" },
        { status: 400 }
      )
    }

    // Refuse PATCHes that would promote a regular user to any protected
    // wildcard role (super_admin or provider_admin).
    const callerIsSuperAdmin = await isUserSuperAdmin(session.user.id)
    if (
      !callerIsSuperAdmin &&
      role_id &&
      (PROTECTED_ROLE_IDS as readonly string[]).includes(role_id)
    ) {
      return NextResponse.json({ error: "Rôle non trouvé" }, { status: 404 })
    }

    // Same guard as POST: tenant rows must reject both legacy "global" roles
    // (operator family — automation.view leakage) and protected wildcards
    // (super_admin / provider_admin — provider-scoped by design).
    const tenantForbiddenRoles = [...PROVIDER_ONLY_ROLE_IDS, ...PROTECTED_ROLE_IDS] as readonly string[]
    if (
      role_id &&
      assignment.tenantId !== DEFAULT_TENANT_ID &&
      tenantForbiddenRoles.includes(role_id)
    ) {
      return NextResponse.json(
        { error: "Ce rôle ne peut être assigné que dans le tenant provider (default)" },
        { status: 400 }
      )
    }

    // Construire le payload Prisma en ne touchant que les champs fournis
    const data: Record<string, unknown> = {}

    if (role_id !== undefined) {
      // Vérifier que le rôle existe
      const role = await prisma.rbacRole.findUnique({ where: { id: role_id }, select: { id: true } })
      if (!role) {
        return NextResponse.json({ error: "Rôle non trouvé" }, { status: 404 })
      }
      data.roleId = role_id
    }

    if (scope_type !== undefined) {
      // Validate against the effective target (incoming, else the existing one)
      // so the shared rule applies; "inherit"/"global" normalize to no target.
      const targetForCheck = scope_target !== undefined ? scope_target : assignment.scopeTarget
      const check = validateAssignmentScope(scope_type, targetForCheck)
      if (!check.ok) {
        return NextResponse.json({ error: check.error }, { status: 400 })
      }
      data.scopeType = check.scopeType
      data.scopeTarget = check.scopeTarget
    } else if (scope_target !== undefined) {
      data.scopeTarget = scope_target || null
    }

    if (expires_at !== undefined) {
      data.expiresAt = expires_at ? new Date(expires_at) : null
    }

    if (Object.keys(data).length === 0) {
      return NextResponse.json({ error: "Aucun champ à mettre à jour" }, { status: 400 })
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
      return NextResponse.json({ error: "Assignation non trouvée" }, { status: 404 })
    }

    // Audit
    await audit({
      action: "rbac_assignment_updated",
      category: "security",
      userId: session.user.id,
      userEmail: session.user.email,
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
      { error: error.message || "Erreur serveur" },
      { status: 500 }
    )
  }
}
