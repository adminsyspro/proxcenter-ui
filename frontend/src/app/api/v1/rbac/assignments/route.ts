// src/app/api/v1/rbac/assignments/route.ts
import { NextRequest, NextResponse } from "next/server"

import { getServerSession } from "next-auth"

import { nanoid } from "nanoid"

import { authOptions } from "@/lib/auth/config"
import { getDb } from "@/lib/db/sqlite"
import { audit } from "@/lib/audit"
import { hasPermission } from "@/lib/rbac"

// GET /api/v1/rbac/assignments - Liste toutes les assignations
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user) {
      return NextResponse.json({ error: "Non autorisé" }, { status: 401 })
    }

    const db = getDb()
    const url = new URL(req.url)
    const userId = url.searchParams.get("user_id")
    const roleId = url.searchParams.get("role_id")

    let query = `
      SELECT 
        ur.id,
        ur.user_id,
        ur.role_id,
        ur.scope_type,
        ur.scope_target,
        ur.granted_at,
        ur.expires_at,
        u.email as user_email,
        u.name as user_name,
        r.name as role_name,
        r.color as role_color,
        r.is_system as role_is_system,
        g.email as granted_by_email
      FROM rbac_user_roles ur
      JOIN users u ON u.id = ur.user_id
      JOIN rbac_roles r ON r.id = ur.role_id
      LEFT JOIN users g ON g.id = ur.granted_by
      WHERE 1=1
    `
    const params: any[] = []

    if (userId) {
      query += " AND ur.user_id = ?"
      params.push(userId)
    }

    if (roleId) {
      query += " AND ur.role_id = ?"
      params.push(roleId)
    }

    query += " ORDER BY ur.granted_at DESC"

    const assignments = db.prepare(query).all(...params) as any[]

    // Transformer les résultats
    const data = assignments.map(a => ({
      id: a.id,
      user: {
        id: a.user_id,
        email: a.user_email,
        name: a.user_name
      },
      role: {
        id: a.role_id,
        name: a.role_name,
        color: a.role_color,
        is_system: a.role_is_system === 1
      },
      scope_type: a.scope_type,
      scope_target: a.scope_target,
      granted_at: a.granted_at,
      granted_by_email: a.granted_by_email,
      expires_at: a.expires_at
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
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user) {
      return NextResponse.json({ error: "Non autorisé" }, { status: 401 })
    }

    if (!hasPermission({ userId: session.user.id, permission: 'admin.rbac' })) {
      return NextResponse.json({ error: "Droits administrateur requis" }, { status: 403 })
    }

    const body = await req.json()
    const { user_id, role_id, scope_type, scope_target, expires_at } = body

    if (!user_id || !role_id) {
      return NextResponse.json({ error: "user_id et role_id requis" }, { status: 400 })
    }

    const validScopes = ["global", "connection", "node", "vm", "tag", "pool"]
    const scopeType = scope_type || "global"

    if (!validScopes.includes(scopeType)) {
      return NextResponse.json({ error: "scope_type invalide" }, { status: 400 })
    }

    if (scopeType !== "global" && !scope_target) {
      return NextResponse.json({ error: "scope_target requis pour ce type de scope" }, { status: 400 })
    }

    const db = getDb()

    // Vérifier que l'utilisateur existe
    const user = db.prepare("SELECT id, email FROM users WHERE id = ?").get(user_id) as any

    if (!user) {
      return NextResponse.json({ error: "Utilisateur non trouvé" }, { status: 404 })
    }

    // Vérifier que le rôle existe
    const role = db.prepare("SELECT id, name FROM rbac_roles WHERE id = ?").get(role_id) as any

    if (!role) {
      return NextResponse.json({ error: "Rôle non trouvé" }, { status: 404 })
    }

    // Vérifier si l'utilisateur a déjà un rôle différent assigné
    const existingRole = db.prepare(`
      SELECT ur.id, r.name as role_name 
      FROM rbac_user_roles ur
      JOIN rbac_roles r ON r.id = ur.role_id
      WHERE ur.user_id = ? AND ur.role_id != ?
      LIMIT 1
    `).get(user_id, role_id) as any

    if (existingRole) {
      return NextResponse.json({ 
        error: `L'utilisateur a déjà le rôle "${existingRole.role_name}". Supprimez-le d'abord ou modifiez l'assignation existante.` 
      }, { status: 400 })
    }

    // Vérifier que cette assignation n'existe pas déjà
    const existing = db.prepare(`
      SELECT id FROM rbac_user_roles 
      WHERE user_id = ? AND role_id = ? AND scope_type = ? AND COALESCE(scope_target, '') = COALESCE(?, '')
    `).get(user_id, role_id, scopeType, scope_target || null)

    if (existing) {
      return NextResponse.json({ error: "Cette assignation existe déjà" }, { status: 400 })
    }

    const id = `assign_${nanoid(12)}`
    const now = new Date().toISOString()

    db.prepare(`
      INSERT INTO rbac_user_roles (id, user_id, role_id, scope_type, scope_target, granted_by, granted_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, user_id, role_id, scopeType, scope_target || null, session.user.id, now, expires_at || null)

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
        scope_target 
      },
      status: "success"
    })

    return NextResponse.json({
      data: {
        id,
        user_id,
        role_id,
        scope_type: scopeType,
        scope_target,
        granted_at: now,
        expires_at
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
