// src/app/api/v1/rbac/assignments/[id]/route.ts
import { NextRequest, NextResponse } from "next/server"

import { getServerSession } from "next-auth"

import { authOptions } from "@/lib/auth/config"
import { getDb } from "@/lib/db/sqlite"
import { audit } from "@/lib/audit"

interface RouteContext {
  params: Promise<{ id: string }>
}

// GET /api/v1/rbac/assignments/[id] - Détails d'une assignation
export async function GET(req: NextRequest, context: RouteContext) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user) {
      return NextResponse.json({ error: "Non autorisé" }, { status: 401 })
    }

    const { id } = await context.params
    const db = getDb()

    const assignment = db.prepare(`
      SELECT 
        ur.*,
        u.email as user_email,
        u.name as user_name,
        r.name as role_name,
        r.color as role_color,
        g.email as granted_by_email
      FROM rbac_user_roles ur
      JOIN users u ON u.id = ur.user_id
      JOIN rbac_roles r ON r.id = ur.role_id
      LEFT JOIN users g ON g.id = ur.granted_by
      WHERE ur.id = ?
    `).get(id) as any

    if (!assignment) {
      return NextResponse.json({ error: "Assignation non trouvée" }, { status: 404 })
    }

    return NextResponse.json({
      data: assignment
    })

  } catch (error: any) {
    console.error("GET /api/v1/rbac/assignments/[id] error:", error)
    
return NextResponse.json(
      { error: error.message || "Erreur serveur" },
      { status: 500 }
    )
  }
}

// DELETE /api/v1/rbac/assignments/[id] - Supprimer une assignation
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

    // Récupérer l'assignation pour l'audit
    const assignment = db.prepare(`
      SELECT ur.*, u.email as user_email, r.name as role_name
      FROM rbac_user_roles ur
      JOIN users u ON u.id = ur.user_id
      JOIN rbac_roles r ON r.id = ur.role_id
      WHERE ur.id = ?
    `).get(id) as any

    if (!assignment) {
      return NextResponse.json({ error: "Assignation non trouvée" }, { status: 404 })
    }

    // Supprimer l'assignation
    db.prepare("DELETE FROM rbac_user_roles WHERE id = ?").run(id)

    // Audit
    await audit({
      action: "rbac_role_revoked",
      category: "security",
      userId: session.user.id,
      userEmail: session.user.email,
      resourceType: "user",
      resourceId: assignment.user_id,
      resourceName: assignment.user_email,
      details: { 
        role_name: assignment.role_name,
        role_id: assignment.role_id,
        scope_type: assignment.scope_type, 
        scope_target: assignment.scope_target 
      },
      status: "success"
    })

    return NextResponse.json({ success: true })

  } catch (error: any) {
    console.error("DELETE /api/v1/rbac/assignments/[id] error:", error)
    
return NextResponse.json(
      { error: error.message || "Erreur serveur" },
      { status: 500 }
    )
  }
}

// PATCH /api/v1/rbac/assignments/[id] - Modifier une assignation
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
    const body = await req.json()
    const { role_id, scope_type, scope_target, expires_at } = body

    const db = getDb()

    // Récupérer l'assignation existante
    const assignment = db.prepare(`
      SELECT ur.*, u.email as user_email, r.name as role_name
      FROM rbac_user_roles ur
      JOIN users u ON u.id = ur.user_id
      JOIN rbac_roles r ON r.id = ur.role_id
      WHERE ur.id = ?
    `).get(id) as any

    if (!assignment) {
      return NextResponse.json({ error: "Assignation non trouvée" }, { status: 404 })
    }

    // Construire les champs à mettre à jour
    const updates: string[] = []
    const params: any[] = []

    if (role_id !== undefined) {
      // Vérifier que le rôle existe
      const role = db.prepare("SELECT id, name FROM rbac_roles WHERE id = ?").get(role_id) as any

      if (!role) {
        return NextResponse.json({ error: "Rôle non trouvé" }, { status: 404 })
      }

      updates.push("role_id = ?")
      params.push(role_id)
    }

    if (scope_type !== undefined) {
      const validScopes = ["global", "connection", "node", "vm"]

      if (!validScopes.includes(scope_type)) {
        return NextResponse.json({ error: "scope_type invalide" }, { status: 400 })
      }

      updates.push("scope_type = ?")
      params.push(scope_type)
    }

    if (scope_target !== undefined) {
      updates.push("scope_target = ?")
      params.push(scope_target || null)
    }

    if (expires_at !== undefined) {
      updates.push("expires_at = ?")
      params.push(expires_at || null)
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: "Aucun champ à mettre à jour" }, { status: 400 })
    }

    // Ajouter l'ID à la fin pour le WHERE
    params.push(id)

    db.prepare(`UPDATE rbac_user_roles SET ${updates.join(", ")} WHERE id = ?`).run(...params)

    // Récupérer l'assignation mise à jour
    const updated = db.prepare(`
      SELECT ur.*, u.email as user_email, r.name as role_name, r.color as role_color
      FROM rbac_user_roles ur
      JOIN users u ON u.id = ur.user_id
      JOIN rbac_roles r ON r.id = ur.role_id
      WHERE ur.id = ?
    `).get(id) as any

    // Audit
    await audit({
      action: "rbac_assignment_updated",
      category: "security",
      userId: session.user.id,
      userEmail: session.user.email,
      resourceType: "user",
      resourceId: assignment.user_id,
      resourceName: assignment.user_email,
      details: { 
        old_role: assignment.role_name,
        new_role: updated.role_name,
        old_scope_type: assignment.scope_type,
        new_scope_type: updated.scope_type,
        old_scope_target: assignment.scope_target,
        new_scope_target: updated.scope_target
      },
      status: "success"
    })

    return NextResponse.json({
      data: {
        id: updated.id,
        user: {
          id: updated.user_id,
          email: updated.user_email
        },
        role: {
          id: updated.role_id,
          name: updated.role_name,
          color: updated.role_color
        },
        scope_type: updated.scope_type,
        scope_target: updated.scope_target,
        expires_at: updated.expires_at
      }
    })

  } catch (error: any) {
    console.error("PATCH /api/v1/rbac/assignments/[id] error:", error)
    
return NextResponse.json(
      { error: error.message || "Erreur serveur" },
      { status: 500 }
    )
  }
}
