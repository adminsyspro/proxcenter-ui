export const dynamic = "force-dynamic"
// src/app/api/v1/rbac/roles/route.ts
import { NextRequest, NextResponse } from "next/server"

import { getServerSession } from "next-auth"

import { Prisma } from "@prisma/client"
import { nanoid } from "nanoid"

import { authOptions } from "@/lib/auth/config"
import { demoResponse } from "@/lib/demo/demo-api"
import { prisma } from "@/lib/db/prisma"
import { audit } from "@/lib/audit"
import { isUserSuperAdmin, PROTECTED_ROLE_IDS } from "@/lib/rbac"
import { validateRoleDefaultScopes } from "@/lib/rbac/scope-validation"
import { getCurrentTenantId } from "@/lib/tenant"

/**
 * Normalize a client-supplied widget_overrides payload into the shape we
 * persist: `{ hidden: string[] }` with deduped, trimmed entries. Returns
 * `null` when the user explicitly clears the override, or `undefined` to
 * leave the column untouched.
 */
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

// GET /api/v1/rbac/roles - Liste tous les rôles
export async function GET(req: NextRequest) {
  const demo = demoResponse(req)
  if (demo) return demo

  try {
    const session = await getServerSession(authOptions)

    if (!session?.user) {
      return NextResponse.json({ error: "Non autorisé" }, { status: 401 })
    }

    // Hide protected (wildcard) roles from non-super-admin callers so a tenant
    // admin with admin.rbac can't assign themselves or others full cluster
    // access.
    const callerIsSuperAdmin = await isUserSuperAdmin(session.user.id)
    const tenantId = await getCurrentTenantId()

    // Tenant scoping: callers see system/global roles (tenant_id IS NULL) plus
    // the custom roles owned by their current tenant. Without this filter a
    // role created from tenant A would leak into tenant B's admin UI.
    const tenantScopeFilter = {
      OR: [
        { tenantId: null },
        { tenantId },
      ],
    }
    const protectedFilter = callerIsSuperAdmin ? {} : { id: { notIn: [...PROTECTED_ROLE_IDS] } }

    const roles = await prisma.rbacRole.findMany({
      where: { AND: [tenantScopeFilter, protectedFilter] },
      select: {
        id: true,
        name: true,
        description: true,
        isSystem: true,
        color: true,
        widgetOverrides: true,
        defaultScopes: true,
        tenantId: true,
        createdAt: true,
        updatedAt: true,
        permissions: {
          select: {
            permission: {
              select: { id: true, name: true, category: true, description: true, isDangerous: true },
            },
          },
        },
        _count: {
          select: {
            userRoles: { where: { tenantId } },
          },
        },
      },
      orderBy: [{ isSystem: "desc" }, { name: "asc" }],
    })

    const rolesWithDetails = roles.map(role => ({
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
      user_count: role._count.userRoles,
    }))

    return NextResponse.json({
      data: rolesWithDetails,
      meta: { total: rolesWithDetails.length }
    })

  } catch (error: any) {
    console.error("GET /api/v1/rbac/roles error:", error)

return NextResponse.json(
      { error: error.message || "Erreur serveur" },
      { status: 500 }
    )
  }
}

// POST /api/v1/rbac/roles - Créer un nouveau rôle
export async function POST(req: NextRequest) {
  const demo = demoResponse(req)
  if (demo) return demo

  try {
    const session = await getServerSession(authOptions)

    if (!session?.user) {
      return NextResponse.json({ error: "Non autorisé" }, { status: 401 })
    }

    // Creating a role lets the caller bundle any permission — including
    // provider-only ones — and then assign it. Reserve the ability to a
    // super admin to prevent tenant admins from shadowing role_super_admin
    // via a custom wildcard role.
    if (!(await isUserSuperAdmin(session.user.id))) {
      return NextResponse.json({ error: "Droits administrateur requis" }, { status: 403 })
    }

    const body = await req.json()
    const { name, description, color, permissions, widget_overrides, default_scopes } = body

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json({ error: "Nom du rôle requis" }, { status: 400 })
    }

    // Role-level default scope (issue #383). New roles are always custom, so
    // it's always allowed here; the validator rejects global/inherit entries.
    let defaultScopes: { scopeType: string; scopeTarget: string }[] | undefined
    if (default_scopes !== undefined && default_scopes !== null) {
      const check = validateRoleDefaultScopes(default_scopes)
      if (!check.ok) {
        return NextResponse.json({ error: check.error }, { status: 400 })
      }
      defaultScopes = check.scopes.length ? check.scopes : undefined
    }

    const trimmedName = name.trim()
    const now = new Date()
    const id = `role_${nanoid(12)}`
    const normalizedOverrides = normalizeWidgetOverrides(widget_overrides)
    const ownerTenantId = await getCurrentTenantId()

    // Custom roles are scoped to the creator's tenant. The compound unique
    // (tenant_id, name) lets two tenants reuse the same role name without
    // colliding, so the existence check is also tenant-scoped.
    const existing = await prisma.rbacRole.findFirst({
      where: { name: trimmedName, tenantId: ownerTenantId },
      select: { id: true },
    })

    if (existing) {
      return NextResponse.json({ error: "Un rôle avec ce nom existe déjà" }, { status: 400 })
    }

    const permIds: string[] = Array.isArray(permissions) ? permissions.filter((p: any) => typeof p === "string") : []

    // Créer le rôle + ses permissions atomiquement
    await prisma.$transaction([
      prisma.rbacRole.create({
        data: {
          id,
          name: trimmedName,
          description: description || null,
          isSystem: false,
          color: color || "#6366f1",
          // Prisma Json? requires DbNull (not JS null) to write SQL NULL.
          // undefined = field omitted on create, which is fine for "no override".
          widgetOverrides:
            normalizedOverrides === undefined ? undefined :
            normalizedOverrides === null ? Prisma.DbNull :
            normalizedOverrides,
          defaultScopes: defaultScopes ?? undefined,
          tenantId: ownerTenantId,
          createdAt: now,
          updatedAt: now,
        },
      }),
      ...(permIds.length > 0
        ? [
            prisma.rbacRolePermission.createMany({
              data: permIds.map(permissionId => ({ roleId: id, permissionId })),
              skipDuplicates: true,
            }),
          ]
        : []),
    ])

    // Audit
    await audit({
      action: "rbac_role_created",
      category: "security",
      userId: session.user.id,
      userEmail: session.user.email,
      resourceType: "rbac_role",
      resourceId: id,
      resourceName: trimmedName,
      details: { permissions: permIds.length },
      status: "success"
    })

    // Retourner le rôle créé avec ses permissions
    const newRole = await prisma.rbacRole.findUnique({
      where: { id },
      include: {
        permissions: { include: { permission: true } },
      },
    })

    if (!newRole) {
      return NextResponse.json({ error: "Erreur lors de la création" }, { status: 500 })
    }

    return NextResponse.json({
      data: {
        id: newRole.id,
        name: newRole.name,
        description: newRole.description,
        is_system: newRole.isSystem,
        color: newRole.color,
        widget_overrides: newRole.widgetOverrides ?? null,
        default_scopes: newRole.defaultScopes ?? null,
        tenant_id: newRole.tenantId,
        created_at: newRole.createdAt.toISOString(),
        updated_at: newRole.updatedAt.toISOString(),
        permissions: newRole.permissions.map(rp => ({
          id: rp.permission.id,
          name: rp.permission.name,
          category: rp.permission.category,
          description: rp.permission.description,
          is_dangerous: rp.permission.isDangerous,
        })),
        user_count: 0,
      },
    }, { status: 201 })

  } catch (error: any) {
    console.error("POST /api/v1/rbac/roles error:", error)

return NextResponse.json(
      { error: error.message || "Erreur serveur" },
      { status: 500 }
    )
  }
}
