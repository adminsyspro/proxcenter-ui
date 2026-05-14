export const dynamic = "force-dynamic"

// src/app/api/v1/rbac/permissions/route.ts
import { NextRequest, NextResponse } from "next/server"

import { getServerSession } from "next-auth"

import { authOptions } from "@/lib/auth/config"
import { demoResponse } from "@/lib/demo/demo-api"
import { prisma } from "@/lib/db/prisma"

// GET /api/v1/rbac/permissions - Liste toutes les permissions disponibles
export async function GET(req: NextRequest) {
  const demo = demoResponse(req)

  if (demo) return demo

  try {
    const session = await getServerSession(authOptions)

    if (!session?.user) {
      return NextResponse.json({ error: "Non autorisé" }, { status: 401 })
    }

    // Récupérer toutes les permissions groupées par catégorie
    const rows = await prisma.rbacPermission.findMany({
      select: { id: true, name: true, category: true, description: true, isDangerous: true },
      orderBy: [{ category: "asc" }, { name: "asc" }],
    })

    // Préserver la forme snake_case attendue par le frontend
    const permissions = rows.map(p => ({
      id: p.id,
      name: p.name,
      category: p.category,
      description: p.description,
      is_dangerous: p.isDangerous,
    }))

    // Grouper par catégorie
    const byCategory = permissions.reduce((acc, perm) => {
      if (!acc[perm.category]) {
        acc[perm.category] = []
      }

      acc[perm.category].push(perm)

      return acc
    }, {} as Record<string, any[]>)

    const categories = Object.keys(byCategory).map(cat => ({
      id: cat,
      label: cat,
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
