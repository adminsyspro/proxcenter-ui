// src/app/api/v1/rbac/roles/route.ts
import { NextRequest, NextResponse } from "next/server"

import { getServerSession } from "next-auth"

import { nanoid } from "nanoid"

import { authOptions } from "@/lib/auth/config"
import { getDb } from "@/lib/db/sqlite"
import { audit } from "@/lib/audit"

// GET /api/v1/rbac/roles - Liste tous les rôles
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user) {
      return NextResponse.json({ error: "Non autorisé" }, { status: 401 })
    }

    const db = getDb()
    
    // Récupérer tous les rôles
    const roles = db.prepare(`
      SELECT id, name, description, is_system, color, created_at, updated_at
      FROM rbac_roles
      ORDER BY is_system DESC, name ASC
    `).all() as any[]

    // Pour chaque rôle, récupérer ses permissions
    const getPermissions = db.prepare(`
      SELECT p.id, p.name, p.category, p.description, p.is_dangerous
      FROM rbac_role_permissions rp
      JOIN rbac_permissions p ON p.id = rp.permission_id
      WHERE rp.role_id = ?
      ORDER BY p.category, p.name
    `)

    // Compter les utilisateurs par rôle
    const countUsers = db.prepare(`
      SELECT COUNT(DISTINCT user_id) as count
      FROM rbac_user_roles
      WHERE role_id = ?
    `)

    const rolesWithDetails = roles.map(role => ({
      ...role,
      is_system: role.is_system === 1,
      permissions: getPermissions.all(role.id),
      user_count: (countUsers.get(role.id) as any)?.count || 0
    }))

    return NextResponse.json({
      data: rolesWithDetails,
      meta: { total: roles.length }
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
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user) {
      return NextResponse.json({ error: "Non autorisé" }, { status: 401 })
    }

    // Vérifier les droits admin
    if (session.user.role !== "admin") {
      return NextResponse.json({ error: "Droits administrateur requis" }, { status: 403 })
    }

    const body = await req.json()
    const { name, description, color, permissions } = body

    if (!name || typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json({ error: "Nom du rôle requis" }, { status: 400 })
    }

    const db = getDb()
    const now = new Date().toISOString()
    const id = `role_${nanoid(12)}`

    // Vérifier que le nom n'existe pas déjà
    const existing = db.prepare("SELECT id FROM rbac_roles WHERE name = ?").get(name.trim())

    if (existing) {
      return NextResponse.json({ error: "Un rôle avec ce nom existe déjà" }, { status: 400 })
    }

    // Créer le rôle
    db.prepare(`
      INSERT INTO rbac_roles (id, name, description, is_system, color, created_at, updated_at)
      VALUES (?, ?, ?, 0, ?, ?, ?)
    `).run(id, name.trim(), description || null, color || "#6366f1", now, now)

    // Ajouter les permissions
    if (Array.isArray(permissions) && permissions.length > 0) {
      const insertPerm = db.prepare(
        "INSERT OR IGNORE INTO rbac_role_permissions (role_id, permission_id) VALUES (?, ?)"
      )

      for (const permId of permissions) {
        insertPerm.run(id, permId)
      }
    }

    // Audit
    await audit({
      action: "rbac_role_created",
      category: "security",
      userId: session.user.id,
      userEmail: session.user.email,
      resourceType: "rbac_role",
      resourceId: id,
      resourceName: name.trim(),
      details: { permissions: permissions?.length || 0 },
      status: "success"
    })

    // Retourner le rôle créé
    const newRole = db.prepare("SELECT * FROM rbac_roles WHERE id = ?").get(id)

    const rolePermissions = db.prepare(`
      SELECT p.* FROM rbac_role_permissions rp
      JOIN rbac_permissions p ON p.id = rp.permission_id
      WHERE rp.role_id = ?
    `).all(id)

    return NextResponse.json({
      data: { ...newRole, permissions: rolePermissions, user_count: 0 }
    }, { status: 201 })

  } catch (error: any) {
    console.error("POST /api/v1/rbac/roles error:", error)
    
return NextResponse.json(
      { error: error.message || "Erreur serveur" },
      { status: 500 }
    )
  }
}
