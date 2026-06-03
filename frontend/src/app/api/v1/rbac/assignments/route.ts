export const dynamic = "force-dynamic"
// src/app/api/v1/rbac/assignments/route.ts
import { NextRequest, NextResponse } from "next/server"

import { getServerSession } from "next-auth"

import { nanoid } from "nanoid"

import { authOptions } from "@/lib/auth/config"
import { prisma } from "@/lib/db/prisma"
import { audit } from "@/lib/audit"
import { hasPermission, isUserSuperAdmin, isUserProtected, PROTECTED_ROLE_IDS, PROVIDER_ONLY_ROLE_IDS } from "@/lib/rbac"
import { validateAssignmentScope } from "@/lib/rbac/scope-validation"
import { DEFAULT_TENANT_ID, getCurrentTenantId } from "@/lib/tenant"
import { demoResponse } from "@/lib/demo/demo-api"

// GET /api/v1/rbac/assignments - Liste toutes les assignations
export async function GET(req: NextRequest) {
  const demo = demoResponse(req)
  if (demo) return demo

  try {
    const session = await getServerSession(authOptions)

    if (!session?.user) {
      return NextResponse.json({ error: "Non autorisé" }, { status: 401 })
    }

    const tenantId = await getCurrentTenantId()
    const url = new URL(req.url)
    const userIdFilter = url.searchParams.get("user_id")
    const roleIdFilter = url.searchParams.get("role_id")

    const callerIsSuperAdmin = await isUserSuperAdmin(session.user.id)
    const now = new Date()

    // Hide every trace of protected roles (super_admin + provider_admin) —
    // both assignments AND any user who holds them anywhere — from
    // non-super-admin callers.
    const protectedUserIds = callerIsSuperAdmin
      ? null
      : new Set(
          (
            await prisma.rbacUserRole.findMany({
              where: {
                roleId: { in: [...PROTECTED_ROLE_IDS] },
                OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
              },
              select: { userId: true },
            })
          ).map(r => r.userId),
        )

    // Provider view (default tenant) returns assignments across every
    // tenant so /security/users can render the per-tenant role
    // breakdown for users with memberships outside `default`. Without
    // this, a tenant_admin role on tenant-1 would be invisible from the
    // provider screen even though the user is listed there.
    const isProviderView = tenantId === DEFAULT_TENANT_ID
    const where: any = isProviderView ? {} : { tenantId }
    if (userIdFilter) where.userId = userIdFilter
    if (roleIdFilter) where.roleId = roleIdFilter
    if (!callerIsSuperAdmin) {
      where.roleId = { ...(where.roleId ? { equals: where.roleId } : {}), notIn: [...PROTECTED_ROLE_IDS] }
      if (protectedUserIds && protectedUserIds.size > 0) {
        where.userId = where.userId
          ? { equals: where.userId, notIn: Array.from(protectedUserIds) }
          : { notIn: Array.from(protectedUserIds) }
      }
    }

    const rows = await prisma.rbacUserRole.findMany({
      where,
      include: {
        user: { select: { id: true, email: true, name: true } },
        role: { select: { id: true, name: true, color: true, isSystem: true } },
        grantedBy: { select: { email: true } },
      },
      orderBy: { grantedAt: "desc" },
    })

    // RbacUserRole.tenantId is a plain string column (no Prisma relation),
    // so we resolve tenant names via a separate batch query keyed on the
    // distinct tenant ids we've collected. The Map lookup keeps the
    // mapping O(1) when projecting the response.
    const tenantIdsInRows = Array.from(new Set(rows.map(r => r.tenantId).filter(Boolean)))
    const tenantsForRows = tenantIdsInRows.length > 0
      ? await prisma.tenant.findMany({
          where: { id: { in: tenantIdsInRows } },
          select: { id: true, name: true },
        })
      : []
    const tenantNameById = new Map(tenantsForRows.map(t => [t.id, t.name]))

    const assignments = rows.map(r => ({
      id: r.id,
      user_id: r.userId,
      role_id: r.roleId,
      tenant_id: r.tenantId,
      tenant_name: tenantNameById.get(r.tenantId) ?? null,
      scope_type: r.scopeType,
      scope_target: r.scopeTarget,
      granted_at: r.grantedAt.toISOString(),
      expires_at: r.expiresAt?.toISOString() ?? null,
      user_email: r.user.email,
      user_name: r.user.name,
      role_name: r.role.name,
      role_color: r.role.color,
      role_is_system: r.role.isSystem,
      granted_by_email: r.grantedBy?.email ?? null,
    }))

    // Surface the global role_super_admin assignment for super-admins who are
    // members of the current tenant. Without this they appear with no role in
    // /security/users of any non-default tenant — their assignment lives on
    // the provider tenant only. Visible to super-admin callers only (the hide
    // filter above already strips protected roles for everyone else).
    // Skipped in provider view: the where:{} clause already returns every
    // tenant's assignment.
    if (callerIsSuperAdmin && !isProviderView) {
      const crossTenantRows = await prisma.rbacUserRole.findMany({
        where: {
          roleId: "role_super_admin",
          tenantId: { not: tenantId },
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
          user: {
            tenants: { some: { tenantId } },
          },
          ...(userIdFilter ? { userId: userIdFilter } : {}),
        },
        include: {
          user: { select: { id: true, email: true, name: true } },
          role: { select: { id: true, name: true, color: true, isSystem: true } },
          grantedBy: { select: { email: true } },
        },
      })

      // Pull names for any tenant ids we haven't already resolved above.
      const extraTenantIds = Array.from(new Set(crossTenantRows.map(r => r.tenantId).filter(t => t && !tenantNameById.has(t))))
      if (extraTenantIds.length > 0) {
        const extras = await prisma.tenant.findMany({
          where: { id: { in: extraTenantIds } },
          select: { id: true, name: true },
        })
        for (const t of extras) tenantNameById.set(t.id, t.name)
      }

      const seen = new Set(assignments.map(a => a.id))
      for (const r of crossTenantRows) {
        if (seen.has(r.id)) continue
        // Prepend so RoleChip (which picks roles[0]) shows "Super Admin" first.
        assignments.unshift({
          id: r.id,
          user_id: r.userId,
          role_id: r.roleId,
          tenant_id: r.tenantId,
          tenant_name: tenantNameById.get(r.tenantId) ?? null,
          scope_type: r.scopeType,
          scope_target: r.scopeTarget,
          granted_at: r.grantedAt.toISOString(),
          expires_at: r.expiresAt?.toISOString() ?? null,
          user_email: r.user.email,
          user_name: r.user.name,
          role_name: r.role.name,
          role_color: r.role.color,
          role_is_system: r.role.isSystem,
          granted_by_email: r.grantedBy?.email ?? null,
        })
      }
    }

    // Transformer les résultats
    const data = assignments.map(a => ({
      id: a.id,
      user: {
        id: a.user_id,
        email: a.user_email,
        name: a.user_name,
      },
      role: {
        id: a.role_id,
        name: a.role_name,
        color: a.role_color,
        is_system: a.role_is_system,
      },
      // tenant_id/tenant_name surface the membership the assignment belongs to —
      // load-bearing for /security/rbac in provider view where one user can hold
      // different roles in different tenants, and for the AssignmentsTab grouping
      // key (user × role × tenant × scope_type) that keeps cross-tenant rows
      // separate instead of collapsing them into one misleading row.
      tenant_id: a.tenant_id,
      tenant_name: a.tenant_name,
      scope_type: a.scope_type,
      scope_target: a.scope_target,
      granted_at: a.granted_at,
      granted_by_email: a.granted_by_email,
      expires_at: a.expires_at,
    }))

    return NextResponse.json({
      data,
      meta: { total: data.length }
    })

  } catch (error: any) {
    console.error("GET /api/v1/rbac/assignments error:", error)

return NextResponse.json(
      { error: error.message || "Erreur serveur" },
      { status: 500 }
    )
  }
}

// POST /api/v1/rbac/assignments - Assigner un rôle à un utilisateur
export async function POST(req: NextRequest) {
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

    const body = await req.json()
    const { user_id, role_id, scope_type, scope_target, expires_at, tenant_id: bodyTenantId } = body

    if (!user_id || !role_id) {
      return NextResponse.json({ error: "user_id et role_id requis" }, { status: 400 })
    }

    // Provider-tenant admins may target any tenant by passing `tenant_id` in
    // the body — that's how /security/rbac in provider view assigns roles
    // across the MSP fleet. Tenant-scoped operators stay pinned to their own
    // tenant (silently ignore the field) so they can't escalate by writing
    // assignments outside their scope.
    const isProviderView = tenantId === DEFAULT_TENANT_ID
    const targetTenantId = isProviderView && typeof bodyTenantId === "string" && bodyTenantId.length > 0
      ? bodyTenantId
      : tenantId

    if (targetTenantId !== tenantId) {
      const tenantExists = await prisma.tenant.findUnique({
        where: { id: targetTenantId },
        select: { id: true, enabled: true },
      })
      if (!tenantExists || !tenantExists.enabled) {
        return NextResponse.json({ error: "Tenant introuvable" }, { status: 404 })
      }
    }

    // Provider-only and protected roles must NEVER land in a non-default tenant:
    //  - legacy roles (operator / vm_admin / viewer / vm_user) grant
    //    automation.view, which would unlock DRS / Site Recovery / Network
    //    Security / Resources for a tenant user — pages Tenant Admin avoids.
    //  - super_admin / provider_admin are wildcards meant for the provider
    //    tenant only; binding them under a tenant is either meaningless
    //    (super_admin is cross-tenant by design) or an escalation surface
    //    (provider_admin's wildcard on a tenant equals tenant_admin++).
    const tenantForbiddenRoles = [...PROVIDER_ONLY_ROLE_IDS, ...PROTECTED_ROLE_IDS] as readonly string[]
    if (targetTenantId !== DEFAULT_TENANT_ID && tenantForbiddenRoles.includes(role_id)) {
      return NextResponse.json(
        { error: "Ce rôle ne peut être assigné que dans le tenant provider (default)" },
        { status: 400 }
      )
    }

    // Prevent self-escalation / self-lockout: a user cannot change their own
    // RBAC assignments. Another admin must do it.
    if (user_id === session.user.id) {
      return NextResponse.json(
        { error: "Vous ne pouvez pas modifier vos propres rôles" },
        { status: 400 }
      )
    }

    // Only an existing super admin can hand out provider-level wildcard
    // roles (super_admin + provider_admin). Also refuse to touch a target that
    // already holds one — prevents a tenant admin from shadowing / reassigning
    // a provider-level operator.
    const callerIsSuperAdmin = await isUserSuperAdmin(session.user.id)
    if (!callerIsSuperAdmin) {
      if ((PROTECTED_ROLE_IDS as readonly string[]).includes(role_id)) {
        return NextResponse.json({ error: "Rôle non trouvé" }, { status: 404 })
      }
      if (await isUserProtected(user_id)) {
        return NextResponse.json({ error: "Utilisateur non trouvé" }, { status: 404 })
      }
    }

    // Default to "inherit" so a manual assignment follows the role's default
    // scope, just like SSO does (issue #383). Explicit scopes still override.
    const scopeCheck = validateAssignmentScope(scope_type || "inherit", scope_target)
    if (!scopeCheck.ok) {
      return NextResponse.json({ error: scopeCheck.error }, { status: 400 })
    }
    const scopeType = scopeCheck.scopeType
    const scopeTarget = scopeCheck.scopeTarget

    // Vérifier que l'utilisateur existe
    const user = await prisma.user.findUnique({
      where: { id: user_id },
      select: { id: true, email: true },
    })

    if (!user) {
      return NextResponse.json({ error: "Utilisateur non trouvé" }, { status: 404 })
    }

    // Tenant membership check: refuse to bind a role to a tenant the target
    // user doesn't belong to. Without this, /security/rbac in provider view
    // would happily create assignments that fire through hasPermission but
    // never apply because every tenant-aware route filters by the session's
    // tenantId — leaving "latent" rows that surface as confusing extra
    // entries in the rbac and users pages. Super admins are exempt because
    // their role is cross-tenant by design and not tied to any single
    // UserTenant row.
    if (!(await isUserSuperAdmin(user_id))) {
      const membership = await prisma.userTenant.findUnique({
        where: { userId_tenantId: { userId: user_id, tenantId: targetTenantId } },
        select: { userId: true },
      })
      if (!membership) {
        return NextResponse.json(
          { error: "L'utilisateur n'est pas membre de ce tenant" },
          { status: 400 }
        )
      }
    }

    // Vérifier que le rôle existe et qu'il est accessible depuis le tenant
    // cible. Un rôle custom appartenant au tenant B ne doit pas être
    // assignable depuis le tenant A même en connaissant son id.
    const role = await prisma.rbacRole.findUnique({ where: { id: role_id }, select: { id: true, name: true, tenantId: true } })

    if (!role || (role.tenantId !== null && role.tenantId !== targetTenantId)) {
      return NextResponse.json({ error: "Rôle non trouvé" }, { status: 404 })
    }

    // Vérifier si l'utilisateur a déjà un rôle différent assigné (within target tenant)
    const existingRole = await prisma.rbacUserRole.findFirst({
      where: { userId: user_id, tenantId: targetTenantId, NOT: { roleId: role_id } },
      include: { role: { select: { name: true } } },
    })

    if (existingRole) {
      return NextResponse.json({
        error: `L'utilisateur a déjà le rôle "${existingRole.role.name}". Supprimez-le d'abord ou modifiez l'assignation existante.`
      }, { status: 400 })
    }

    // Vérifier que cette assignation n'existe pas déjà (within target tenant).
    // SQLite traitait NULL via COALESCE pour comparer scope_target — on
    // reproduit ça en filtrant null vs string explicitement.
    const existingAssignment = await prisma.rbacUserRole.findFirst({
      where: {
        userId: user_id,
        roleId: role_id,
        scopeType,
        scopeTarget,
        tenantId: targetTenantId,
      },
      select: { id: true },
    })

    if (existingAssignment) {
      return NextResponse.json({ error: "Cette assignation existe déjà" }, { status: 400 })
    }

    const id = `assign_${nanoid(12)}`
    const now = new Date()
    const expiresAt = expires_at ? new Date(expires_at) : null

    await prisma.rbacUserRole.create({
      data: {
        id,
        userId: user_id,
        roleId: role_id,
        scopeType,
        scopeTarget,
        tenantId: targetTenantId,
        grantedById: session.user.id,
        grantedAt: now,
        expiresAt,
      },
    })

    // Audit
    await audit({
      action: "rbac_role_assigned",
      category: "security",
      userId: session.user.id,
      userEmail: session.user.email,
      resourceType: "user",
      resourceId: user_id,
      resourceName: user.email,
      details: {
        role_name: role.name,
        role_id,
        scope_type: scopeType,
        scope_target: scopeTarget,
        tenant_id: targetTenantId,
      },
      status: "success"
    })

    return NextResponse.json({
      data: {
        id,
        user_id,
        role_id,
        tenant_id: targetTenantId,
        scope_type: scopeType,
        scope_target: scopeTarget,
        granted_at: now.toISOString(),
        expires_at: expiresAt?.toISOString() ?? null,
      }
    }, { status: 201 })

  } catch (error: any) {
    console.error("POST /api/v1/rbac/assignments error:", error)

return NextResponse.json(
      { error: error.message || "Erreur serveur" },
      { status: 500 }
    )
  }
}
