// src/app/api/v1/users/[id]/route.ts
import { NextResponse } from "next/server"

import { getServerSession } from "next-auth"

import { authOptions } from "@/lib/auth/config"
import { getDb } from "@/lib/db/sqlite"
import { hashPassword } from "@/lib/auth/password"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

// GET /api/v1/users/[id] - Récupérer un utilisateur
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    // RBAC: Check admin.users permission
    const denied = await checkPermission(PERMISSIONS.ADMIN_USERS)

    if (denied) return denied

    const { id } = await params
    const db = getDb()

    const user = db
      .prepare(
        `SELECT id, email, name, role, auth_provider, enabled, last_login_at, created_at, updated_at 
         FROM User WHERE id = ?`
      )
      .get(id)

    if (!user) {
      return NextResponse.json({ error: "Utilisateur non trouvé" }, { status: 404 })
    }

    return NextResponse.json({ data: user })
  } catch (error: any) {
    console.error("Erreur GET user:", error)
    
return NextResponse.json({ error: error?.message || "Erreur serveur" }, { status: 500 })
  }
}

// PATCH /api/v1/users/[id] - Modifier un utilisateur
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    // RBAC: Check admin.users permission
    const denied = await checkPermission(PERMISSIONS.ADMIN_USERS)

    if (denied) return denied

    const session = await getServerSession(authOptions)
    const { id } = await params
    const body = await req.json()
    const { name, enabled, password } = body

    const db = getDb()

    // Vérifier que l'utilisateur existe
    const user = db.prepare("SELECT * FROM User WHERE id = ?").get(id) as any

    if (!user) {
      return NextResponse.json({ error: "Utilisateur non trouvé" }, { status: 404 })
    }

    // Construire la requête de mise à jour
    const updates: string[] = []
    const values: any[] = []

    if (name !== undefined) {
      updates.push("name = ?")
      values.push(name)
    }

    if (enabled !== undefined) {
      updates.push("enabled = ?")
      values.push(enabled ? 1 : 0)
    }

    if (password) {
      if (password.length < 8) {
        return NextResponse.json(
          { error: "Le mot de passe doit contenir au moins 8 caractères" },
          { status: 400 }
        )
      }

      const hashedPassword = await hashPassword(password)

      updates.push("password = ?")
      values.push(hashedPassword)
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: "Aucune modification fournie" }, { status: 400 })
    }

    updates.push("updated_at = ?")
    values.push(new Date().toISOString())
    values.push(id)

    db.prepare(`UPDATE User SET ${updates.join(", ")} WHERE id = ?`).run(...values)

    // Récupérer l'utilisateur mis à jour
    const updatedUser = db
      .prepare(
        `SELECT id, email, name, role, auth_provider, enabled, last_login_at, created_at, updated_at 
         FROM User WHERE id = ?`
      )
      .get(id) as any

    // Audit
    const { audit } = await import("@/lib/audit")
    const changes: Record<string, any> = {}

    if (name !== undefined) changes.name = name
    if (enabled !== undefined) changes.enabled = enabled
    if (password) changes.passwordChanged = true

    await audit({
      action: "update",
      category: "users",
      resourceType: "user",
      resourceId: id,
      resourceName: updatedUser?.email,
      details: changes,
      status: "success",
    })

    return NextResponse.json({ success: true, data: updatedUser })
  } catch (error: any) {
    console.error("Erreur PATCH user:", error)
    
return NextResponse.json({ error: error?.message || "Erreur serveur" }, { status: 500 })
  }
}

// DELETE /api/v1/users/[id] - Supprimer un utilisateur
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    // RBAC: Check admin.users permission
    const denied = await checkPermission(PERMISSIONS.ADMIN_USERS)

    if (denied) return denied

    const session = await getServerSession(authOptions)
    const { id } = await params
    const db = getDb()

    // Vérifier que l'utilisateur existe
    const user = db.prepare("SELECT * FROM User WHERE id = ?").get(id) as any

    if (!user) {
      return NextResponse.json({ error: "Utilisateur non trouvé" }, { status: 404 })
    }

    // Empêcher la suppression de son propre compte
    if (user.id === session.user.id) {
      return NextResponse.json(
        { error: "Vous ne pouvez pas supprimer votre propre compte" },
        { status: 400 }
      )
    }

    // Supprimer les assignations RBAC de l'utilisateur
    db.prepare("DELETE FROM rbac_user_roles WHERE user_id = ?").run(id)
    db.prepare("DELETE FROM rbac_user_permissions WHERE user_id = ?").run(id)

    // Supprimer l'utilisateur
    db.prepare("DELETE FROM User WHERE id = ?").run(id)

    // Audit
    const { audit } = await import("@/lib/audit")

    await audit({
      action: "delete",
      category: "users",
      resourceType: "user",
      resourceId: id,
      resourceName: user.email,
      details: {},
      status: "success",
    })

    return NextResponse.json({ success: true })
  } catch (error: any) {
    console.error("Erreur DELETE user:", error)
    
return NextResponse.json({ error: error?.message || "Erreur serveur" }, { status: 500 })
  }
}
