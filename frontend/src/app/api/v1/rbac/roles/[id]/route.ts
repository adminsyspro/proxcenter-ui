export const dynamic = "force-dynamic"
// src/app/api/v1/rbac/roles/[id]/route.ts
import { NextRequest, NextResponse } from "next/server"

import { Prisma } from "@prisma/client"

import { authorizeAdminRead, getActingSession } from "@/lib/auth/actingUser"
import { prisma } from "@/lib/db/prisma"
import { audit } from "@/lib/audit"
import { isUserSuperAdmin, PERMISSIONS, PROTECTED_ROLE_IDS } from "@/lib/rbac"
import { validateRoleDefaultScopes } from "@/lib/rbac/scope-validation"
import { canReadRoleAssignments } from "@/lib/rbac/assignmentReadAccess"
import { findUnknownTenant, refuseOverCeiling } from "@/lib/rbac/catalogueGuards"
import {
  isRoleAssignableInTenant,
  parsePublicationInput,
  publicationFields,
  PUBLISHED_AUDIENCES,
  type RoleAudience,
} from "@/lib/rbac/rolePublication"
import { assignmentsRevokedByPublication, isServiceDeskRowId, syncServiceDeskForRole } from "@/lib/rbac/serviceDesk"
import { DEFAULT_TENANT_ID } from "@/lib/tenant/constants"
import { getCurrentTenantId } from "@/lib/tenant"
import { demoResponse } from "@/lib/demo/demo-api"
import { withAudit } from "@/lib/audit/withAudit"
import { withPublicApiGuard } from "@/lib/api-tokens/routeGuard"

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
  return NextResponse.json({ error: "Role not found" }, { status: 404 })
}

/** A role is reachable from the current tenant if it is global (system role,
 *  tenantId IS NULL) or owned by that tenant. Anything else 404s to avoid
 *  leaking the existence of roles belonging to other tenants. */
function isRoleReachableFromTenant(role: { tenantId: string | null }, currentTenantId: string): boolean {
  return role.tenantId === null || role.tenantId === currentTenantId
}

// GET /api/v1/rbac/roles/[id] - Détails d'un rôle
async function handleGet(req: Request, context: RouteContext) {
  const demo = demoResponse(req)
  if (demo) return demo

  try {
    const reader = await authorizeAdminRead(PERMISSIONS.ADMIN_RBAC_VIEW)
    if (reader.denied) return reader.denied

    const { id } = await context.params
    const superAdminBlock = await denyIfProtectedRoleAndCallerIsNot(id, reader.userId)
    if (superAdminBlock) return superAdminBlock

    const tenantId = await getCurrentTenantId()

    const role = await prisma.rbacRole.findUnique({
      where: { id },
      include: {
        publications: { select: { tenantId: true } },
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

    // A customer tenant also reads the catalogue roles offered to it (ui#1336).
    const offeredToTenant = !!role && tenantId !== DEFAULT_TENANT_ID && role.audience === "tenant" && isRoleAssignableInTenant(role, tenantId)
    if (!role || (!isRoleReachableFromTenant(role, tenantId) && !offeredToTenant)) {
      return NextResponse.json({ error: "Role not found" }, { status: 404 })
    }

    // The role's holders only with admin.users or admin.rbac (or their
    // .view), roadmap#223; a token reached this line through admin.rbac.view.
    const holders = !reader.userId || (await canReadRoleAssignments(reader.userId, tenantId)) ? role.userRoles : []

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
        ...publicationFields(role, tenantId === DEFAULT_TENANT_ID),
        created_at: role.createdAt.toISOString(),
        updated_at: role.updatedAt.toISOString(),
        permissions: role.permissions.map(rp => ({
          id: rp.permission.id,
          name: rp.permission.name,
          category: rp.permission.category,
          description: rp.permission.description,
          is_dangerous: rp.permission.isDangerous,
        })),
        users: holders.map(ur => ({
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
      { error: error.message || "Server error" },
      { status: 500 }
    )
  }
}

export const GET = withPublicApiGuard("rbac-role-get", handleGet)

// PATCH /api/v1/rbac/roles/[id] - Modifier un rôle
async function handlePatch(req: NextRequest, context: RouteContext) {
  const demo = demoResponse(req)
  if (demo) return demo

  try {
    const session = await getActingSession()

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Modifying or deleting a role (including its permission set) is reserved
    // to super admins — otherwise a tenant admin with admin.rbac could swap
    // their role's perms for wildcard and self-escalate.
    if (!(await isUserSuperAdmin(session.user.id))) {
      return NextResponse.json({ error: "Admin rights required" }, { status: 403 })
    }

    const { id } = await context.params
    const superAdminBlock = await denyIfProtectedRoleAndCallerIsNot(id, session.user.id)
    if (superAdminBlock) return superAdminBlock

    const role = await prisma.rbacRole.findUnique({
      where: { id },
      include: {
        publications: { select: { tenantId: true } },
        permissions: { select: { permissionId: true } },
      },
    })
    const callerTenantId = await getCurrentTenantId()

    if (!role || !isRoleReachableFromTenant(role, callerTenantId)) {
      return NextResponse.json({ error: "Role not found" }, { status: 404 })
    }

    const body = await req.json()
    const { name, description, color, permissions, widget_overrides, default_scopes } = body

    // Catalogue audience and publication (ui#1336). Absent fields keep the
    // role's current publication.
    const touchesPublication = body.audience !== undefined || body.publish_all !== undefined || body.published_tenants !== undefined
    if (touchesPublication && (role.isSystem || role.tenantId !== DEFAULT_TENANT_ID)) {
      return NextResponse.json({ error: "Only a custom role of the provider tenant can be published" }, { status: 400 })
    }
    if (touchesPublication && body.audience === null && role.audience !== null) {
      return NextResponse.json({ error: "A catalogue role cannot go back to a single-tenant role" }, { status: 400 })
    }
    // Absent publication fields keep the current ones, unless the role leaves
    // the published audiences (a legacy role's grandfathered SSO tenants do not
    // follow it into the provider audience).
    const targetAudience = body.audience === undefined ? role.audience : body.audience
    const keepsPublication = (PUBLISHED_AUDIENCES as readonly unknown[]).includes(targetAudience)
    const publication = parsePublicationInput({
      audience: targetAudience,
      publish_all: body.publish_all ?? (keepsPublication ? role.publishAll : false),
      published_tenants: body.published_tenants ?? (keepsPublication ? (role.publications ?? []).map(p => p.tenantId) : []),
    })
    if (touchesPublication && !publication.ok) {
      return NextResponse.json({ error: publication.error }, { status: 400 })
    }
    const nextPublication = publication.ok ? publication.value : null
    if (touchesPublication && nextPublication) {
      if (role.audience === "service_desk" && nextPublication.audience !== "service_desk") {
        const held = await prisma.rbacServiceDeskAssignment.count({ where: { roleId: id } })
        if (held > 0) {
          return NextResponse.json({ error: `This role has ${held} service desk assignment(s). Remove them first.` }, { status: 400 })
        }
      }
      const unknownTenant = await findUnknownTenant(nextPublication.tenantIds)
      if (unknownTenant) {
        return NextResponse.json({ error: `Unknown tenant: ${unknownTenant}` }, { status: 400 })
      }
    }

    // The ceiling applies to the permissions the role will carry, whichever
    // of the two changes.
    const resultingAudience: RoleAudience | null = touchesPublication && nextPublication ? nextPublication.audience : (role.audience as RoleAudience | null)
    const resultingPerms: string[] = Array.isArray(permissions)
      ? permissions.filter((p: any) => typeof p === "string")
      : (role.permissions ?? []).map(p => p.permissionId)
    if (!role.isSystem && (touchesPublication || Array.isArray(permissions))) {
      const refusal = await refuseOverCeiling(resultingAudience, resultingPerms, session.user, name || role.name)
      if (refusal) return refusal
    }

    // Tenants leaving the publication lose the assignments made there: the
    // caller sees them first and confirms (issue: "shows the assignments that
    // would be revoked and asks for confirmation").
    let revoked: { tenantId: string; tenantName: string; count: number }[] = []
    if (touchesPublication && nextPublication && nextPublication.audience !== null) {
      const published = (PUBLISHED_AUDIENCES as readonly string[]).includes(nextPublication.audience)
      const kept: Set<string> | "all" = published && nextPublication.publishAll ? "all" : new Set(published ? nextPublication.tenantIds : [])
      revoked = await assignmentsRevokedByPublication(id, kept)
      if (revoked.length > 0 && body.confirm_revoke !== true) {
        return NextResponse.json(
          {
            error: "Changing the publication revokes assignments in these tenants",
            code: "REVOKE_CONFIRMATION_REQUIRED",
            revoked: revoked.map(r => ({ tenant_id: r.tenantId, tenant_name: r.tenantName, count: r.count })),
          },
          { status: 409 },
        )
      }
    }
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
        return NextResponse.json({ error: "Cannot modify a system role" }, { status: 400 })
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
        return NextResponse.json({ error: "A role with this name already exists" }, { status: 400 })
      }
    }

    const updateData: {
      name?: string
      description?: string | null
      color?: string
      widgetOverrides?: any
      defaultScopes?: any
      audience?: string | null
      publishAll?: boolean
      updatedAt: Date
    } = {
      updatedAt: now,
    }
    if (touchesPublication && nextPublication) {
      updateData.audience = nextPublication.audience
      updateData.publishAll = nextPublication.publishAll
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

      if (touchesPublication && nextPublication) {
        await tx.rbacRolePublication.deleteMany({ where: { roleId: id } })
        if (nextPublication.tenantIds.length > 0) {
          await tx.rbacRolePublication.createMany({
            data: nextPublication.tenantIds.map(tenantId => ({ roleId: id, tenantId })),
            skipDuplicates: true,
          })
        }
        // The confirmed revocations: ordinary rows of the tenants that left.
        // Service-desk rows follow in syncServiceDeskForRole below.
        const lostTenants = revoked.map(r => r.tenantId)
        if (lostTenants.length > 0) {
          const rows = await tx.rbacUserRole.findMany({
            where: { roleId: id, tenantId: { in: lostTenants } },
            select: { id: true },
          })
          const ordinary = rows.map(r => r.id).filter(rowId => !isServiceDeskRowId(rowId))
          if (ordinary.length > 0) await tx.rbacUserRole.deleteMany({ where: { id: { in: ordinary } } })
        }
      }
    })

    if (touchesPublication) {
      const sync = await syncServiceDeskForRole(id)
      const before = new Set((role.publications ?? []).map(p => p.tenantId))
      const after = new Set(nextPublication?.tenantIds ?? [])
      await audit({
        action: "rbac_role_publication_changed",
        category: "security",
        userId: session.user.id,
        userEmail: session.user.email,
        resourceType: "rbac_role",
        resourceId: id,
        resourceName: name || role.name,
        details: {
          audience: nextPublication?.audience ?? null,
          publish_all: nextPublication?.publishAll ?? false,
          tenants_added: [...after].filter(t => !before.has(t)),
          tenants_removed: [...before].filter(t => !after.has(t)),
          revoked: revoked.map(r => ({ tenant_id: r.tenantId, count: r.count })),
          service_desk_added: sync.added,
          service_desk_removed: sync.removed,
        },
        status: "success",
      })
    }

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
      include: { permissions: { include: { permission: true } }, publications: { select: { tenantId: true } } },
    })

    if (!updated) {
      return NextResponse.json({ error: "Role not found" }, { status: 404 })
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
        ...publicationFields(updated, true),
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
      { error: error.message || "Server error" },
      { status: 500 }
    )
  }
}

// DELETE /api/v1/rbac/roles/[id] - Supprimer un rôle
async function handleDelete(req: NextRequest, context: RouteContext) {
  const demo = demoResponse(req)
  if (demo) return demo

  try {
    const session = await getActingSession()

    if (!session?.user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
    }

    // Modifying or deleting a role (including its permission set) is reserved
    // to super admins — otherwise a tenant admin with admin.rbac could swap
    // their role's perms for wildcard and self-escalate.
    if (!(await isUserSuperAdmin(session.user.id))) {
      return NextResponse.json({ error: "Admin rights required" }, { status: 403 })
    }

    const { id } = await context.params
    const superAdminBlock = await denyIfProtectedRoleAndCallerIsNot(id, session.user.id)
    if (superAdminBlock) return superAdminBlock

    const role = await prisma.rbacRole.findUnique({ where: { id } })
    const callerTenantIdForDelete = await getCurrentTenantId()

    if (!role || !isRoleReachableFromTenant(role, callerTenantIdForDelete)) {
      return NextResponse.json({ error: "Role not found" }, { status: 404 })
    }

    if (role.isSystem) {
      return NextResponse.json({ error: "Cannot delete a system role" }, { status: 400 })
    }

    // Vérifier si des utilisateurs utilisent ce rôle (tous tenants confondus,
    // car la suppression est globale).
    const userCount =
      (await prisma.rbacUserRole.count({ where: { roleId: id } })) +
      (await prisma.rbacServiceDeskAssignment.count({ where: { roleId: id } }))

    if (userCount > 0) {
      return NextResponse.json({
        error: `This role is assigned to ${userCount} user(s). Remove the assignments first.`
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
      { error: error.message || "Server error" },
      { status: 500 }
    )
  }
}

export const PATCH = withAudit({ category: "security", resourceType: "role", resourceParam: "id" }, handlePatch)
export const DELETE = withAudit({ category: "security", resourceType: "role", resourceParam: "id" }, handleDelete)
