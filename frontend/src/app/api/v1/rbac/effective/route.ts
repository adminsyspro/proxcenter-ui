export const dynamic = "force-dynamic"

// src/app/api/v1/rbac/effective/route.ts
import { NextRequest, NextResponse } from "next/server"

import { getServerSession } from "next-auth"

import { authOptions } from "@/lib/auth/config"
import { prisma } from "@/lib/db/prisma"
import { hasPermission, isUserSuperAdmin } from "@/lib/rbac"
import { getCurrentTenantId } from "@/lib/tenant"
import { demoResponse } from "@/lib/demo/demo-api"

// GET /api/v1/rbac/effective - Récupérer les permissions effectives d'un utilisateur
// Query params: user_id (optionnel, admin only), resource_type, resource_id
export async function GET(req: NextRequest) {
  const demo = demoResponse(req)

  if (demo) return demo

  try {
    const session = await getServerSession(authOptions)

    if (!session?.user) {
      return NextResponse.json({ error: "Non autorisé" }, { status: 401 })
    }

    const url = new URL(req.url)
    const targetUserId = url.searchParams.get("user_id") || session.user.id
    const resourceType = url.searchParams.get("resource_type") // 'vm', 'node', 'connection'
    const resourceId = url.searchParams.get("resource_id")

    const tenantId = await getCurrentTenantId()

    // Seuls les admins peuvent voir les permissions d'autres utilisateurs
    if (
      targetUserId !== session.user.id &&
      !(await hasPermission({ userId: session.user.id, permission: "admin.rbac", tenantId }))
    ) {
      return NextResponse.json(
        { error: "Non autorisé à voir les permissions d'autres utilisateurs" },
        { status: 403 },
      )
    }

    // Vérifier que l'utilisateur existe
    const user = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, email: true, role: true },
    })

    if (!user) {
      return NextResponse.json({ error: "Utilisateur non trouvé" }, { status: 404 })
    }

    const now = new Date()
    const activeFilter = { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }

    // Super admin shortcut: cross-tenant access, returns every defined permission
    if (await isUserSuperAdmin(targetUserId)) {
      const allPerms = await prisma.rbacPermission.findMany({
        select: { id: true, name: true, category: true },
      })

      const superAdminAssignment = await prisma.rbacUserRole.findFirst({
        where: { userId: targetUserId, roleId: "role_super_admin" },
        select: { role: { select: { id: true, name: true, color: true } } },
      })


return NextResponse.json({
        data: {
          user_id: targetUserId,
          is_super_admin: true,
          roles: superAdminAssignment
            ? [{
                id: superAdminAssignment.role.id,
                name: superAdminAssignment.role.name,
                color: superAdminAssignment.role.color,
                scope_type: "global",
                scope_target: null,
              }]
            : [],
          permissions: allPerms.map(p => p.name),
          permission_details: allPerms.map(p => ({
            id: p.id,
            name: p.name,
            category: p.category,
            source: "role",
            source_name: "Super Admin",
            scope_type: "global",
            scope_target: null,
          })),
          scope_types: ["global"],

          // Super admins never carry widget denylists — they see everything.
          hidden_widgets: [],
        },
      })
    }

    // Récupérer les rôles de l'utilisateur (scoped by tenant) avec leurs permissions
    const userRoles = await prisma.rbacUserRole.findMany({
      where: { userId: targetUserId, tenantId, ...activeFilter },
      select: {
        id: true,
        scopeType: true,
        scopeTarget: true,
        expiresAt: true,
        role: {
          select: {
            id: true,
            name: true,
            color: true,
            widgetOverrides: true,
            permissions: {
              select: { permission: { select: { id: true, name: true, category: true } } },
            },
          },
        },
      },
    })

    // Récupérer les permissions directes de l'utilisateur (scoped by tenant)
    const directPermissions = await prisma.rbacUserPermission.findMany({
      where: { userId: targetUserId, tenantId, ...activeFilter },
      select: {
        scopeType: true,
        scopeTarget: true,
        permission: { select: { id: true, name: true, category: true } },
      },
    })

    // Calculer les permissions effectives
    const effectivePermissions = new Set<string>()
    const permissionDetails: any[] = []

    // Ajouter les permissions via les rôles
    for (const ur of userRoles) {
      const matches = checkScopeMatch(ur.scopeType, ur.scopeTarget, resourceType, resourceId)

      if (!matches) continue

      for (const rp of ur.role.permissions) {
        const perm = rp.permission

        if (!effectivePermissions.has(perm.name)) {
          effectivePermissions.add(perm.name)
          permissionDetails.push({
            id: perm.id,
            name: perm.name,
            category: perm.category,
            source: "role",
            source_name: ur.role.name,
            scope_type: ur.scopeType,
            scope_target: ur.scopeTarget,
          })
        }
      }
    }

    // Ajouter les permissions directes
    for (const dp of directPermissions) {
      const matches = checkScopeMatch(dp.scopeType, dp.scopeTarget, resourceType, resourceId)

      if (matches && !effectivePermissions.has(dp.permission.name)) {
        effectivePermissions.add(dp.permission.name)
        permissionDetails.push({
          id: dp.permission.id,
          name: dp.permission.name,
          category: dp.permission.category,
          source: "direct",
          scope_type: dp.scopeType,
          scope_target: dp.scopeTarget,
        })
      }
    }

    const isSuperAdmin = userRoles.some(ur => ur.role.id === "role_super_admin")

    // Aggregate widget denylists across all of the user's active roles. Union
    // semantics: if any role hides a widget, it's hidden for the user.
    const hiddenWidgets = new Set<string>()

    for (const ur of userRoles) {
      const overrides = ur.role.widgetOverrides as { hidden?: string[] } | null

      if (overrides?.hidden && Array.isArray(overrides.hidden)) {
        for (const w of overrides.hidden) {
          if (typeof w === "string" && w) hiddenWidgets.add(w)
        }
      }
    }

    // Aggregate scope types across roles AND direct user permissions, so
    // downstream consumers (e.g. dashboard widget visibility) don't have to
    // re-derive it and don't miss users whose access comes from a direct
    // permission grant rather than a role.
    const scopeTypes = new Set<string>()

    for (const ur of userRoles) {
      if (ur.scopeType) scopeTypes.add(ur.scopeType)
    }

    for (const dp of directPermissions) {
      if (dp.scopeType) scopeTypes.add(dp.scopeType)
    }

    return NextResponse.json({
      data: {
        user_id: targetUserId,
        is_super_admin: isSuperAdmin,
        roles: userRoles.map(ur => ({
          id: ur.role.id,
          name: ur.role.name,
          color: ur.role.color,
          scope_type: ur.scopeType,
          scope_target: ur.scopeTarget,
        })),
        permissions: Array.from(effectivePermissions),
        permission_details: permissionDetails,
        scope_types: Array.from(scopeTypes),
        hidden_widgets: Array.from(hiddenWidgets),
      },
    })

  } catch (error: any) {
    console.error("GET /api/v1/rbac/effective error:", error)

return NextResponse.json(
      { error: error.message || "Erreur serveur" },
      { status: 500 }
    )
  }
}

// Fonction pour vérifier si un scope correspond à une ressource
function checkScopeMatch(
  scopeType: string,
  scopeTarget: string | null,
  resourceType: string | null,
  resourceId: string | null
): boolean {
  // Scope global = accès à tout
  if (scopeType === "global") {
    return true
  }

  // Si pas de filtre de ressource demandé, inclure toutes les permissions
  if (!resourceType || !resourceId) {
    return true
  }

  // Vérifier selon le type de scope
  switch (scopeType) {
    case "connection":
      // Le scope connection correspond si resourceId commence par le connection_id
      return resourceId.startsWith(scopeTarget || "")

    case "node":
      // Node scope matches when the resource sits on this node. Both
      // scopeTarget and resourceId carry the cluster prefix:
      //   scopeTarget : "connectionId:nodeName"
      //   resourceId  : "connectionId:nodeName"             (node itself)
      //              or "connectionId:nodeName:type:vmid"   (VM/CT on the node)
      // The previous `parts[1] === scopeTarget` check compared just the
      // nodeName against the full composite key and always failed, so
      // /security/users showed empty effective-permission lists for any
      // node-scoped grant — diverging from the canonical `scopeMatches`
      // in src/lib/rbac/index.ts that the rest of the API uses.
      if (scopeTarget) {
        return resourceId === scopeTarget || resourceId.startsWith(scopeTarget + ":")
      }

      return false

    case "vm":
      // Le scope VM correspond exactement
      return resourceId === scopeTarget

    case "tag":
    case "pool":
      // Tag/pool permissions are always listed in effective perms
      // Actual scope resolution happens at access time via resourceMeta
      return true

    default:
      return false
  }
}
