// src/app/api/v1/rbac/roles/[id]/route.ts
import { NextRequest, NextResponse } from "next/server"

import { getServerSession } from "next-auth"

import { authOptions } from "@/lib/auth/config"
import { getDb } from "@/lib/db/sqlite"
import { audit } from "@/lib/audit"

interface RouteContext {
  params: Promise<{ id: string }>
}

// GET /api/v1/rbac/roles/[id] - Détails d'un rôle
export async function GET(req: NextRequest, context: RouteContext) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user) {
      return NextResponse.json({ error: "Non autorisé" }, { status: 401 })
    }

    const { id } = await context.params
    const db = getDb()

    const role = db.prepare(`
      SELECT id, name, description, is_system, color, created_at, updated_at
      FROM rbac_roles WHERE id = ?
    `).get(id) as any

    if (!role) {
      return NextResponse.json({ error: "Rôle non trouvé" }, { status: 404 })
    }

    // Récupérer les permissions
    const permissions = db.prepare(`
      SELECT p.id, p.name, p.category, p.description, p.is_dangerous
      FROM rbac_role_permissions rp
      JOIN rbac_permissions p ON p.id = rp.permission_id
      WHERE rp.role_id = ?
      ORDER BY p.category, p.name
    `).all(id)

    // Récupérer les utilisateurs assignés à ce rôle
    const users = db.prepare(`
      SELECT 
        ur.id as assignment_id,
        ur.scope_type,
        ur.scope_target,
        ur.granted_at,
        ur.expires_at,
        u.id as user_id,
        u.email,
        u.name,
        g.email as granted_by_email
      FROM rbac_user_roles ur
      JOIN users u ON u.id = ur.user_id
      LEFT JOIN users g ON g.id = ur.granted_by
      WHERE ur.role_id = ?
      ORDER BY ur.granted_at DESC
    `).all(id)

    return NextResponse.json({
      data: {
        ...role,
        is_system: role.is_system === 1,
        permissions,
        users
      }
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
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user) {
      return NextResponse.json({ error: "Non autorisé" }, { status: 401 })
    }

    if (session.user.role !== "admin") {
      return NextResponse.json({ error: "Droits administrateur requis" }, { status: 403 })
    }

    const { id } = await context.params
    const db = getDb()

    const role = db.prepare("SELECT * FROM rbac_roles WHERE id = ?").get(id) as any

    if (!role) {
      return NextResponse.json({ error: "Rôle non trouvé" }, { status: 404 })
    }

    if (role.is_system === 1) {
      return NextResponse.json({ error: "Impossible de modifier un rôle système" }, { status: 400 })
    }

    const body = await req.json()
    const { name, description, color, permissions } = body
    const now = new Date().toISOString()

    // Vérifier l'unicité du nom si modifié
    if (name && name !== role.name) {
      const existing = db.prepare("SELECT id FROM rbac_roles WHERE name = ? AND id != ?").get(name, id)

      if (existing) {
        return NextResponse.json({ error: "Un rôle avec ce nom existe déjà" }, { status: 400 })
      }
    }

    // Mettre à jour le rôle
    db.prepare(`
      UPDATE rbac_roles 
      SET name = COALESCE(?, name),
          description = COALESCE(?, description),
          color = COALESCE(?, color),
          updated_at = ?
      WHERE id = ?
    `).run(name || null, description, color || null, now, id)

    // Mettre à jour les permissions si fournies
    if (Array.isArray(permissions)) {
      // Supprimer les anciennes
      db.prepare("DELETE FROM rbac_role_permissions WHERE role_id = ?").run(id)
      
      // Ajouter les nouvelles
      const insertPerm = db.prepare(
        "INSERT OR IGNORE INTO rbac_role_permissions (role_id, permission_id) VALUES (?, ?)"
      )

      for (const permId of permissions) {
        insertPerm.run(id, permId)
      }
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
    const updatedRole = db.prepare("SELECT * FROM rbac_roles WHERE id = ?").get(id)

    const rolePermissions = db.prepare(`
      SELECT p.* FROM rbac_role_permissions rp
      JOIN rbac_permissions p ON p.id = rp.permission_id
      WHERE rp.role_id = ?
    `).all(id)

    return NextResponse.json({
      data: { ...updatedRole, permissions: rolePermissions }
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
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user) {
      return NextResponse.json({ error: "Non autorisé" }, { status: 401 })
    }

    if (session.user.role !== "admin") {
      return NextResponse.json({ error: "Droits administrateur requis" }, { status: 403 })
    }

    const { id } = await context.params
    const db = getDb()

    const role = db.prepare("SELECT * FROM rbac_roles WHERE id = ?").get(id) as any

    if (!role) {
      return NextResponse.json({ error: "Rôle non trouvé" }, { status: 404 })
    }

    if (role.is_system === 1) {
      return NextResponse.json({ error: "Impossible de supprimer un rôle système" }, { status: 400 })
    }

    // Vérifier si des utilisateurs utilisent ce rôle
    const userCount = db.prepare(
      "SELECT COUNT(*) as count FROM rbac_user_roles WHERE role_id = ?"
    ).get(id) as any

    if (userCount.count > 0) {
      return NextResponse.json({ 
        error: `Ce rôle est assigné à ${userCount.count} utilisateur(s). Retirez les assignations d'abord.` 
      }, { status: 400 })
    }

    // Supprimer le rôle (les permissions liées seront supprimées par CASCADE)
    db.prepare("DELETE FROM rbac_roles WHERE id = ?").run(id)

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
