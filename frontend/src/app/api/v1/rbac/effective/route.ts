// src/app/api/v1/rbac/effective/route.ts
import { NextRequest, NextResponse } from "next/server"

import { getServerSession } from "next-auth"

import { authOptions } from "@/lib/auth/config"
import { getDb } from "@/lib/db/sqlite"

// GET /api/v1/rbac/effective - Récupérer les permissions effectives d'un utilisateur
// Query params: user_id (optionnel, admin only), resource_type, resource_id
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user) {
      return NextResponse.json({ error: "Non autorisé" }, { status: 401 })
    }

    const url = new URL(req.url)
    let targetUserId = url.searchParams.get("user_id") || session.user.id
    const resourceType = url.searchParams.get("resource_type") // 'vm', 'node', 'connection'
    const resourceId = url.searchParams.get("resource_id")

    // Seuls les admins peuvent voir les permissions d'autres utilisateurs
    if (targetUserId !== session.user.id && session.user.role !== "admin") {
      return NextResponse.json({ error: "Non autorisé à voir les permissions d'autres utilisateurs" }, { status: 403 })
    }

    const db = getDb()

    // Vérifier que l'utilisateur existe
    const user = db.prepare("SELECT id, email, role FROM users WHERE id = ?").get(targetUserId) as any

    if (!user) {
      return NextResponse.json({ error: "Utilisateur non trouvé" }, { status: 404 })
    }

    // Si l'utilisateur a le rôle "admin" dans la table users (ancien système), il a tout
    if (user.role === "admin") {
      const allPermissions = db.prepare("SELECT id, name, category FROM rbac_permissions").all() as any[]

      
return NextResponse.json({
        data: {
          user_id: targetUserId,
          is_super_admin: true,
          roles: [{ name: "Admin (Legacy)", scope: "global" }],
          permissions: allPermissions.map(p => p.name),
          permission_details: allPermissions
        }
      })
    }

    // Récupérer les rôles de l'utilisateur
    const userRoles = db.prepare(`
      SELECT 
        ur.id as assignment_id,
        ur.scope_type,
        ur.scope_target,
        ur.expires_at,
        r.id as role_id,
        r.name as role_name,
        r.color
      FROM rbac_user_roles ur
      JOIN rbac_roles r ON r.id = ur.role_id
      WHERE ur.user_id = ?
        AND (ur.expires_at IS NULL OR ur.expires_at > datetime('now'))
    `).all(targetUserId) as any[]

    // Récupérer les permissions directes de l'utilisateur
    const directPermissions = db.prepare(`
      SELECT 
        up.scope_type,
        up.scope_target,
        p.id as permission_id,
        p.name as permission_name,
        p.category
      FROM rbac_user_permissions up
      JOIN rbac_permissions p ON p.id = up.permission_id
      WHERE up.user_id = ?
        AND (up.expires_at IS NULL OR up.expires_at > datetime('now'))
    `).all(targetUserId) as any[]

    // Calculer les permissions effectives
    const effectivePermissions = new Set<string>()
    const permissionDetails: any[] = []

    // Ajouter les permissions via les rôles
    for (const role of userRoles) {
      // Vérifier si le scope correspond à la ressource demandée
      const scopeMatches = checkScopeMatch(role.scope_type, role.scope_target, resourceType, resourceId)
      
      if (scopeMatches) {
        const rolePermissions = db.prepare(`
          SELECT p.id, p.name, p.category
          FROM rbac_role_permissions rp
          JOIN rbac_permissions p ON p.id = rp.permission_id
          WHERE rp.role_id = ?
        `).all(role.role_id) as any[]

        for (const perm of rolePermissions) {
          if (!effectivePermissions.has(perm.name)) {
            effectivePermissions.add(perm.name)
            permissionDetails.push({
              ...perm,
              source: "role",
              source_name: role.role_name,
              scope_type: role.scope_type,
              scope_target: role.scope_target
            })
          }
        }
      }
    }

    // Ajouter les permissions directes
    for (const perm of directPermissions) {
      const scopeMatches = checkScopeMatch(perm.scope_type, perm.scope_target, resourceType, resourceId)
      
      if (scopeMatches && !effectivePermissions.has(perm.permission_name)) {
        effectivePermissions.add(perm.permission_name)
        permissionDetails.push({
          id: perm.permission_id,
          name: perm.permission_name,
          category: perm.category,
          source: "direct",
          scope_type: perm.scope_type,
          scope_target: perm.scope_target
        })
      }
    }

    return NextResponse.json({
      data: {
        user_id: targetUserId,
        is_super_admin: false,
        roles: userRoles.map(r => ({
          id: r.role_id,
          name: r.role_name,
          color: r.color,
          scope_type: r.scope_type,
          scope_target: r.scope_target
        })),
        permissions: Array.from(effectivePermissions),
        permission_details: permissionDetails
      }
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
      // Le scope node correspond si la ressource est sur ce nœud
      // Format attendu pour resourceId: "connection_id:node:..."
      if (scopeTarget) {
        const parts = resourceId.split(":")

        
return parts[1] === scopeTarget
      }

      
return false
    
    case "vm":
      // Le scope VM correspond exactement
      return resourceId === scopeTarget
    
    default:
      return false
  }
}
