// src/app/api/v1/users/route.ts
import { NextResponse } from "next/server"

import { nanoid } from "nanoid"

import { getDb } from "@/lib/db/sqlite"
import { hashPassword } from "@/lib/auth/password"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { getCurrentTenantId } from "@/lib/tenant"

export const runtime = "nodejs"

// GET /api/v1/users - Liste des utilisateurs
export async function GET() {
  try {
    // RBAC: Check admin.users permission
    const denied = await checkPermission(PERMISSIONS.ADMIN_USERS)

    if (denied) return denied

    const db = getDb()
    const tenantId = await getCurrentTenantId()

    const users = db
      .prepare(
        `SELECT u.id, u.email, u.name, u.role, u.auth_provider, u.enabled, u.last_login_at, u.created_at, u.updated_at
         FROM users u JOIN user_tenants ut ON ut.user_id = u.id
         WHERE ut.tenant_id = ?
         ORDER BY u.created_at DESC`
      )
      .all(tenantId)

    // Compter les admins in this tenant
    const adminCount = db
      .prepare(
        `SELECT COUNT(*) as count FROM users u JOIN user_tenants ut ON ut.user_id = u.id
         WHERE u.role = 'admin' AND ut.tenant_id = ?`
      )
      .get(tenantId) as { count: number }

    return NextResponse.json({
      data: users,
      meta: {
        total: users.length,
        adminCount: adminCount.count,
      },
    })
  } catch (error: any) {
    console.error("Erreur GET users:", error)
    
return NextResponse.json({ error: error?.message || "Erreur serveur" }, { status: 500 })
  }
}

// POST /api/v1/users - Créer un utilisateur
export async function POST(req: Request) {
  try {
    // RBAC: Check admin.users permission
    const denied = await checkPermission(PERMISSIONS.ADMIN_USERS)

    if (denied) return denied

    const body = await req.json()
    const { email, password, name } = body

    if (!email || !password) {
      return NextResponse.json({ error: "Email et mot de passe requis" }, { status: 400 })
    }

    // Valider l'email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

    if (!emailRegex.test(email)) {
      return NextResponse.json({ error: "Format d'email invalide" }, { status: 400 })
    }

    // Valider le mot de passe
    if (password.length < 8) {
      return NextResponse.json(
        { error: "Le mot de passe doit contenir au moins 8 caractères" },
        { status: 400 }
      )
    }

    const db = getDb()

    // Vérifier si l'email existe déjà
    const existing = db.prepare("SELECT id FROM users WHERE email = ?").get(email.toLowerCase())

    if (existing) {
      return NextResponse.json({ error: "Cet email est déjà utilisé" }, { status: 400 })
    }

    // Hasher le mot de passe
    const hashedPassword = await hashPassword(password)

    // Créer l'utilisateur (role par défaut 'user' - les permissions viennent de RBAC)
    const id = nanoid()
    const now = new Date().toISOString()

    const tenantId = await getCurrentTenantId()

    db.prepare(
      `INSERT INTO users (id, email, password, name, role, auth_provider, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'user', 'credentials', 1, ?, ?)`
    ).run(id, email.toLowerCase().trim(), hashedPassword, name || null, now, now)

    // Add user to the current tenant
    db.prepare(
      `INSERT INTO user_tenants (user_id, tenant_id, is_default, joined_at) VALUES (?, ?, 1, ?)`
    ).run(id, tenantId, now)

    // Audit
    const { audit } = await import("@/lib/audit")

    await audit({
      action: "create",
      category: "users",
      resourceType: "user",
      resourceId: id,
      resourceName: email.toLowerCase().trim(),
      details: { name: name || null },
      status: "success",
    })

    return NextResponse.json({
      success: true,
      data: {
        id,
        email: email.toLowerCase().trim(),
        name: name || null,
        auth_provider: "credentials",
        enabled: 1,
        created_at: now,
      },
    })
  } catch (error: any) {
    console.error("Erreur POST users:", error)
    
return NextResponse.json({ error: error?.message || "Erreur serveur" }, { status: 500 })
  }
}
