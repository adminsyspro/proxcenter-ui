export const dynamic = "force-dynamic"
// src/app/api/v1/rbac/roles/[id]/route.ts
import { NextRequest, NextResponse } from "next/server"

import { getServerSession } from "next-auth"

import { Prisma } from "@prisma/client"

import { authOptions } from "@/lib/auth/config"
import { prisma } from "@/lib/db/prisma"
import { audit } from "@/lib/audit"
import { isUserSuperAdmin, PROTECTED_ROLE_IDS } from "@/lib/rbac"
import { validateRoleDefaultScopes } from "@/lib/rbac/scope-validation"
import { getCurrentTenantId } from "@/lib/tenant"
import { demoResponse } from "@/lib/demo/demo-api"

/** See POST /api/v1/rbac/roles — same shape, same dedup rules. */
function normalizeWidgetOverrides(raw: unknown): { hidden: string[] } | null | undefined {
  if (raw === undefined) return undefined
  if (raw === null) return null
  if (typeof raw !== "object") return null

  const hidden = (raw as any).hidden
  if (!Array.isArray(hidden)) return null

  const clean = Array.from(new Set(
    hidden
      .filter((h: any) => typeof h === "string")
      .map((h: string) => h.trim())
      .filter(Boolean),
  ))

  return clean.length === 0 ? null : { hidden: clean }
}

interface RouteContext {
  params: Promise<{ id: string }>
}

/** Hide protected wildcard roles from non-super-admin callers. 404 rather than 403 to avoid leaking existence. */
async function denyIfProtectedRoleAndCallerIsNot(
  roleId: string,
  callerUserId: string | undefined
): Promise<NextResponse | null> {
  if (!(PROTECTED_ROLE_IDS as readonly string[]).includes(roleId)) return null
  if (callerUserId && (await isUserSuperAdmin(callerUserId))) return null
  return NextResponse.json({ error: "Rôle non trouvé" }, { status: 404 })
}

/** A role is reachable from the current tenant if it is global (system role,
 *  tenantId IS NULL) or owned by that tenant. Anything else 404s to avoid
 *  leaking the existence of roles belonging to other tenants. */
function isRoleReachableFromTenant(role: { tenantId: string | null }, currentTenantId: string): boolean {
  return role.tenantId === null || role.tenantId === currentTenantId
}

// GET /api/v1/rbac/roles/[id] - Détails d'un rôle
export async function GET(req: NextRequest, context: RouteContext) {
  const demo = demoResponse(req)
  if (demo) return demo

  try {
    const session = await getServerSession(authOptions)

    if (!session?.user) {
      return NextResponse.json({ error: "Non autorisé" }, { status: 401 })
    }

    const { id } = await context.params
    const superAdminBlock = await denyIfProtectedRoleAndCallerIsNot(id, session.user.id)
    if (superAdminBlock) return superAdminBlock

    const tenantId = await getCurrentTenantId()

    const role = await prisma.rbacRole.findUnique({
      where: { id },
      include: {
        permissions: {
          include: { permission: true },
          orderBy: [{ permission: { category: "asc" } }, { permission: { name: "asc" } }],
        },
        userRoles: {
          where: { tenantId },
          include: {
            user: { select: { id: true, email: true, name: true } },
            grantedBy: { select: { email: true } },
          },
          orderBy: { grantedAt: "desc" },
        },
      },
    })

    if (!role || !isRoleReachableFromTenant(role, tenantId)) {
      return NextResponse.json({ error: "Rôle non trouvé" }, { status: 404 })
    }

    return NextResponse.json({
      data: {
        id: role.id,
        name: role.name,
        description: role.description,
        is_system: role.isSystem,
        color: role.color,
        widget_overrides: role.widgetOverrides ?? null,
        default_scopes: role.defaultScopes ?? null,
        tenant_id: role.tenantId,
        created_at: role.createdAt.toISOString(),
        updated_at: role.updatedAt.toISOString(),
        permissions: role.permissions.map(rp => ({
          id: rp.permission.id,
          name: rp.permission.name,
          category: rp.permission.category,
          description: rp.permission.description,
          is_dangerous: rp.permission.isDangerous,
        })),
        users: role.userRoles.map(ur => ({
          assignment_id: ur.id,
          scope_type: ur.scopeType,
          scope_target: ur.scopeTarget,
          granted_at: ur.grantedAt.toISOString(),
          expires_at: ur.expiresAt?.toISOString() ?? null,
          user_id: ur.user.id,
          email: ur.user.email,
          name: ur.user.name,
          granted_by_email: ur.grantedBy?.email ?? null,
        })),
      },
    })

  } catch (error: any) {
    console.error("GET /api/v1/rbac/roles/[id] error:", error)

return NextResponse.json(
      { error: error.message || "Erreur serveur" },
      { status: 500 }
    )
  }
}

// PATCH /api/v1/rbac/roles/[id] - Modifier un rôle
export async function PATCH(req: NextRequest, context: RouteContext) {
  const demo = demoResponse(req)
  if (demo) return demo

  try {
    const session = await getServerSession(authOptions)

    if (!session?.user) {
      return NextResponse.json({ error: "Non autorisé" }, { status: 401 })
    }

    // Modifying or deleting a role (including its permission set) is reserved
    // to super admins — otherwise a tenant admin with admin.rbac could swap
    // their role's perms for wildcard and self-escalate.
    if (!(await isUserSuperAdmin(session.user.id))) {
      return NextResponse.json({ error: "Droits administrateur requis" }, { status: 403 })
    }

    const { id } = await context.params
    const superAdminBlock = await denyIfProtectedRoleAndCallerIsNot(id, session.user.id)
    if (superAdminBlock) return superAdminBlock

    const role = await prisma.rbacRole.findUnique({ where: { id } })
    const callerTenantId = await getCurrentTenantId()

    if (!role || !isRoleReachableFromTenant(role, callerTenantId)) {
      return NextResponse.json({ error: "Rôle non trouvé" }, { status: 404 })
    }

    const body = await req.json()
    const { name, description, color, permissions, widget_overrides, default_scopes } = body
    const now = new Date()
    const normalizedOverrides = normalizeWidgetOverrides(widget_overrides)

    // System roles are immutable except for widget overrides — those purely
    // hide UI elements and grant no privileges, so admins can tailor the
    // dashboard for system roles without forking them. default_scopes is NOT
    // allowed on system roles: their super-admin/protected shortcuts bypass
    // scope resolution, so a scope there would be silently ignored (issue #383).
    if (role.isSystem) {
      const touchedSystemImmutable =
        name !== undefined ||
        description !== undefined ||
        color !== undefined ||
        default_scopes !== undefined ||
        Array.isArray(permissions)

      if (touchedSystemImmutable) {
        return NextResponse.json({ error: "Impossible de modifier un rôle système" }, { status: 400 })
      }
    }

    // Validate the role's default scope when provided (custom roles only —
    // system roles are rejected above). An empty list clears it.
    let defaultScopesUpdate: { scopeType: string; scopeTarget: string }[] | null | undefined
    if (default_scopes !== undefined) {
      if (default_scopes === null) {
        defaultScopesUpdate = null
      } else {
        const check = validateRoleDefaultScopes(default_scopes)
        if (!check.ok) {
          return NextResponse.json({ error: check.error }, { status: 400 })
        }
        defaultScopesUpdate = check.scopes.length ? check.scopes : null
      }
    }

    // Vérifier l'unicité du nom si modifié — scopé au tenant propriétaire du
    // rôle (compound unique (tenant_id, name) côté DB).
    if (name && name !== role.name) {
      const existing = await prisma.rbacRole.findFirst({
        where: { name, tenantId: role.tenantId, NOT: { id } },
        select: { id: true },
      })

      if (existing) {
        return NextResponse.json({ error: "Un rôle avec ce nom existe déjà" }, { status: 400 })
      }
    }

    const updateData: {
      name?: string
      description?: string | null
      color?: string
      widgetOverrides?: any
      defaultScopes?: any
      updatedAt: Date
    } = {
      updatedAt: now,
    }
    if (name !== undefined) updateData.name = name
    if (description !== undefined) updateData.description = description
    if (color !== undefined) updateData.color = color
    // Prisma Json? distinguishes "skip" (undefined) from "set to SQL NULL"
    // (Prisma.DbNull) — sending JS null here would either be rejected by
    // TypeScript or fail at runtime depending on the client version.
    if (normalizedOverrides !== undefined) {
      updateData.widgetOverrides = normalizedOverrides === null ? Prisma.DbNull : normalizedOverrides
    }
    if (defaultScopesUpdate !== undefined) {
      updateData.defaultScopes = defaultScopesUpdate === null ? Prisma.DbNull : defaultScopesUpdate
    }

    const replacePermissions = Array.isArray(permissions)
    const permIds: string[] = replacePermissions ? permissions.filter((p: any) => typeof p === "string") : []

    // Mettre à jour le rôle + remplacer les permissions atomiquement si fournies
    await prisma.$transaction(async tx => {
      await tx.rbacRole.update({ where: { id }, data: updateData })

      if (replacePermissions) {
        await tx.rbacRolePermission.deleteMany({ where: { roleId: id } })
        if (permIds.length > 0) {
          await tx.rbacRolePermission.createMany({
            data: permIds.map(permissionId => ({ roleId: id, permissionId })),
            skipDuplicates: true,
          })
        }
      }
    })

    // Audit
    await audit({
      action: "rbac_role_updated",
      category: "security",
      userId: session.user.id,
      userEmail: session.user.email,
      resourceType: "rbac_role",
      resourceId: id,
      resourceName: name || role.name,
      details: { changes: Object.keys(body) },
      status: "success"
    })

    // Retourner le rôle mis à jour
    const updated = await prisma.rbacRole.findUnique({
      where: { id },
      include: { permissions: { include: { permission: true } } },
    })

    if (!updated) {
      return NextResponse.json({ error: "Rôle non trouvé" }, { status: 404 })
    }

    return NextResponse.json({
      data: {
        id: updated.id,
        name: updated.name,
        description: updated.description,
        is_system: updated.isSystem,
        color: updated.color,
        widget_overrides: updated.widgetOverrides ?? null,
        default_scopes: updated.defaultScopes ?? null,
        tenant_id: updated.tenantId,
        created_at: updated.createdAt.toISOString(),
        updated_at: updated.updatedAt.toISOString(),
        permissions: updated.permissions.map(rp => ({
          id: rp.permission.id,
          name: rp.permission.name,
          category: rp.permission.category,
          description: rp.permission.description,
          is_dangerous: rp.permission.isDangerous,
        })),
      },
    })

  } catch (error: any) {
    console.error("PATCH /api/v1/rbac/roles/[id] error:", error)

return NextResponse.json(
      { error: error.message || "Erreur serveur" },
      { status: 500 }
    )
  }
}

// DELETE /api/v1/rbac/roles/[id] - Supprimer un rôle
export async function DELETE(req: NextRequest, context: RouteContext) {
  const demo = demoResponse(req)
  if (demo) return demo

  try {
    const session = await getServerSession(authOptions)

    if (!session?.user) {
      return NextResponse.json({ error: "Non autorisé" }, { status: 401 })
    }

    // Modifying or deleting a role (including its permission set) is reserved
    // to super admins — otherwise a tenant admin with admin.rbac could swap
    // their role's perms for wildcard and self-escalate.
    if (!(await isUserSuperAdmin(session.user.id))) {
      return NextResponse.json({ error: "Droits administrateur requis" }, { status: 403 })
    }

    const { id } = await context.params
    const superAdminBlock = await denyIfProtectedRoleAndCallerIsNot(id, session.user.id)
    if (superAdminBlock) return superAdminBlock

    const role = await prisma.rbacRole.findUnique({ where: { id } })
    const callerTenantIdForDelete = await getCurrentTenantId()

    if (!role || !isRoleReachableFromTenant(role, callerTenantIdForDelete)) {
      return NextResponse.json({ error: "Rôle non trouvé" }, { status: 404 })
    }

    if (role.isSystem) {
      return NextResponse.json({ error: "Impossible de supprimer un rôle système" }, { status: 400 })
    }

    // Vérifier si des utilisateurs utilisent ce rôle (tous tenants confondus,
    // car la suppression est globale).
    const userCount = await prisma.rbacUserRole.count({ where: { roleId: id } })

    if (userCount > 0) {
      return NextResponse.json({
        error: `Ce rôle est assigné à ${userCount} utilisateur(s). Retirez les assignations d'abord.`
      }, { status: 400 })
    }

    // Supprimer le rôle (les permissions liées seront supprimées par CASCADE)
    await prisma.rbacRole.delete({ where: { id } })

    // Audit
    await audit({
      action: "rbac_role_deleted",
      category: "security",
      userId: session.user.id,
      userEmail: session.user.email,
      resourceType: "rbac_role",
      resourceId: id,
      resourceName: role.name,
      status: "success"
    })

    return NextResponse.json({ success: true })

  } catch (error: any) {
    console.error("DELETE /api/v1/rbac/roles/[id] error:", error)

return NextResponse.json(
      { error: error.message || "Erreur serveur" },
      { status: 500 }
    )
  }
}
