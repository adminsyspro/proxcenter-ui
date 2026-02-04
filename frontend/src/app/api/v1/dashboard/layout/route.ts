import { NextResponse } from "next/server"

import { prisma } from "@/lib/db/prisma"
import { DEFAULT_LAYOUT, PRESET_LAYOUTS } from "@/components/dashboard/types"

export const runtime = "nodejs"

/**
 * GET /api/v1/dashboard/layout
 * Récupère le layout actif de l'utilisateur
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url)
    const userId = url.searchParams.get('userId') || 'default'

    // Chercher le layout actif de l'utilisateur
    const layout = await prisma.dashboardLayout.findFirst({
      where: { 
        userId,
        isActive: true 
      },
      orderBy: { updatedAt: 'desc' }
    })

    if (layout) {
      return NextResponse.json({
        data: {
          id: layout.id,
          name: layout.name,
          widgets: JSON.parse(layout.widgets),
          isActive: layout.isActive,
          updatedAt: layout.updatedAt,
        }
      })
    }

    // Pas de layout sauvegardé, retourner le défaut
    return NextResponse.json({
      data: {
        id: null,
        name: 'default',
        widgets: DEFAULT_LAYOUT,
        isActive: true,
        updatedAt: null,
      }
    })
  } catch (e: any) {
    console.error("[dashboard/layout] GET error:", e)
    
return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

/**
 * PUT /api/v1/dashboard/layout
 * Sauvegarde le layout de l'utilisateur
 */
export async function PUT(req: Request) {
  try {
    const body = await req.json()
    const { userId = 'default', name = 'custom', widgets } = body

    if (!widgets || !Array.isArray(widgets)) {
      return NextResponse.json({ error: "widgets array is required" }, { status: 400 })
    }

    // Désactiver les autres layouts de l'utilisateur
    await prisma.dashboardLayout.updateMany({
      where: { userId },
      data: { isActive: false }
    })

    // Créer ou mettre à jour le layout
    const layout = await prisma.dashboardLayout.upsert({
      where: { 
        userId_name: { userId, name }
      },
      create: {
        userId,
        name,
        widgets: JSON.stringify(widgets),
        isActive: true,
      },
      update: {
        widgets: JSON.stringify(widgets),
        isActive: true,
        updatedAt: new Date(),
      }
    })

    return NextResponse.json({
      data: {
        id: layout.id,
        name: layout.name,
        widgets: JSON.parse(layout.widgets),
        isActive: layout.isActive,
        updatedAt: layout.updatedAt,
      }
    })
  } catch (e: any) {
    console.error("[dashboard/layout] PUT error:", e)
    
return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

/**
 * DELETE /api/v1/dashboard/layout
 * Supprime le layout personnalisé et revient au défaut
 */
export async function DELETE(req: Request) {
  try {
    const url = new URL(req.url)
    const userId = url.searchParams.get('userId') || 'default'

    // Supprimer tous les layouts de l'utilisateur
    await prisma.dashboardLayout.deleteMany({
      where: { userId }
    })

    return NextResponse.json({
      data: {
        message: "Layout reset to default",
        widgets: DEFAULT_LAYOUT,
      }
    })
  } catch (e: any) {
    console.error("[dashboard/layout] DELETE error:", e)
    
return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
