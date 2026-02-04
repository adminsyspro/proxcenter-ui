// src/app/api/v1/rbac/permissions/route.ts
import { NextRequest, NextResponse } from "next/server"

import { getServerSession } from "next-auth"

import { authOptions } from "@/lib/auth/config"
import { getDb } from "@/lib/db/sqlite"

// GET /api/v1/rbac/permissions - Liste toutes les permissions disponibles
export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(authOptions)

    if (!session?.user) {
      return NextResponse.json({ error: "Non autorisé" }, { status: 401 })
    }

    const db = getDb()
    
    // Récupérer toutes les permissions groupées par catégorie
    const permissions = db.prepare(`
      SELECT id, name, category, description, is_dangerous
      FROM rbac_permissions
      ORDER BY category, name
    `).all() as any[]

    // Grouper par catégorie
    const byCategory = permissions.reduce((acc, perm) => {
      if (!acc[perm.category]) {
        acc[perm.category] = []
      }

      acc[perm.category].push({
        ...perm,
        is_dangerous: perm.is_dangerous === 1
      })
      
return acc
    }, {} as Record<string, any[]>)

    // Définir l'ordre et les labels des catégories
    const categoryLabels: Record<string, string> = {
      vm: "Machines virtuelles",
      storage: "Stockage",
      node: "Nœuds",
      connection: "Connexions",
      backup: "Sauvegardes",
      admin: "Administration"
    }

    const categories = Object.keys(byCategory).map(cat => ({
      id: cat,
      label: categoryLabels[cat] || cat,
      permissions: byCategory[cat]
    }))

    return NextResponse.json({
      data: permissions,
      categories,
      meta: { total: permissions.length }
    })

  } catch (error: any) {
    console.error("GET /api/v1/rbac/permissions error:", error)
    
return NextResponse.json(
      { error: error.message || "Erreur serveur" },
      { status: 500 }
    )
  }
}
