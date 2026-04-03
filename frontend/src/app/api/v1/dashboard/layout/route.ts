import { NextResponse } from "next/server"

import { getServerSession } from "next-auth"

import { getSessionPrisma } from "@/lib/tenant"
import { DEFAULT_LAYOUT } from "@/components/dashboard/types"
import { authOptions } from "@/lib/auth/config"
import { demoResponse } from "@/lib/demo/demo-api"

export const runtime = "nodejs"

const MAX_DASHBOARDS = 20

function getUserId(session: any, url?: URL) {
  return session?.user?.id || url?.searchParams.get('userId') || 'default'
}

/**
 * GET /api/v1/dashboard/layout
 *   ?list=true     -> list all dashboards for user
 *   ?name=xxx      -> load a specific dashboard
 *   (default)      -> load the active dashboard
 */
export async function GET(req: Request) {
  const demo = demoResponse(req)
  if (demo) return demo

  try {
    const prisma = await getSessionPrisma()
    const session = await getServerSession(authOptions)
    const url = new URL(req.url)
    const userId = getUserId(session, url)
    const list = url.searchParams.get('list')
    const name = url.searchParams.get('name')

    // List all dashboards
    if (list === 'true') {
      const layouts = await prisma.dashboardLayout.findMany({
        where: { userId },
        orderBy: { updatedAt: 'desc' },
        select: { id: true, name: true, isActive: true, updatedAt: true },
      })

      // Migrate old "custom" names
      return NextResponse.json({
        data: layouts.map(l => ({ ...l, name: l.name === 'custom' ? 'Default' : l.name }))
      })
    }

    // Load specific dashboard by name
    if (name) {
      const layout = await prisma.dashboardLayout.findFirst({
        where: { userId, name },
      })

      if (layout) {
        return NextResponse.json({
          data: {
            id: layout.id, name: layout.name,
            widgets: JSON.parse(layout.widgets),
            isActive: layout.isActive, updatedAt: layout.updatedAt,
          }
        })
      }

      return NextResponse.json({ error: "Dashboard not found" }, { status: 404 })
    }

    // Load active dashboard
    const layout = await prisma.dashboardLayout.findFirst({
      where: { userId, isActive: true },
      orderBy: { updatedAt: 'desc' },
    })

    if (layout) {
      // Migrate old "custom" name to "Default"
      const displayName = layout.name === 'custom' ? 'Default' : layout.name

      if (layout.name === 'custom') {
        await prisma.dashboardLayout.update({ where: { id: layout.id }, data: { name: 'Default' } }).catch(() => {})
      }

      return NextResponse.json({
        data: {
          id: layout.id, name: displayName,
          widgets: JSON.parse(layout.widgets),
          isActive: layout.isActive, updatedAt: layout.updatedAt,
        }
      })
    }

    return NextResponse.json({
      data: { id: null, name: 'Default', widgets: DEFAULT_LAYOUT, isActive: true, updatedAt: null }
    })
  } catch (e: any) {
    console.error("[dashboard/layout] GET error:", e)

    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

/**
 * PUT /api/v1/dashboard/layout
 * Save widgets to a dashboard (create or update)
 * Body: { name, widgets }
 */
export async function PUT(req: Request) {
  const demo = demoResponse(req)
  if (demo) return demo

  try {
    const prisma = await getSessionPrisma()
    const session = await getServerSession(authOptions)
    const userId = getUserId(session)
    const body = await req.json()
    const { name = 'Default', widgets } = body

    if (!widgets || !Array.isArray(widgets)) {
      return NextResponse.json({ error: "widgets array is required" }, { status: 400 })
    }

    // Deactivate others, activate this one
    await prisma.dashboardLayout.updateMany({
      where: { userId },
      data: { isActive: false },
    })

    const layout = await prisma.dashboardLayout.upsert({
      where: { userId_name: { userId, name } },
      create: { userId, name, widgets: JSON.stringify(widgets), isActive: true },
      update: { widgets: JSON.stringify(widgets), isActive: true, updatedAt: new Date() },
    })

    return NextResponse.json({
      data: {
        id: layout.id, name: layout.name,
        widgets: JSON.parse(layout.widgets),
        isActive: layout.isActive, updatedAt: layout.updatedAt,
      }
    })
  } catch (e: any) {
    console.error("[dashboard/layout] PUT error:", e)

    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

/**
 * POST /api/v1/dashboard/layout
 * Create a new dashboard
 * Body: { name, widgets? }
 */
export async function POST(req: Request) {
  const demo = demoResponse(req)
  if (demo) return demo

  try {
    const prisma = await getSessionPrisma()
    const session = await getServerSession(authOptions)
    const userId = getUserId(session)
    const body = await req.json()
    const { name, widgets } = body

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      return NextResponse.json({ error: "name is required" }, { status: 400 })
    }

    // Check limit
    const count = await prisma.dashboardLayout.count({ where: { userId } })

    if (count >= MAX_DASHBOARDS) {
      return NextResponse.json({ error: `Maximum ${MAX_DASHBOARDS} dashboards reached` }, { status: 400 })
    }

    // Check name uniqueness
    const existing = await prisma.dashboardLayout.findFirst({ where: { userId, name: name.trim() } })

    if (existing) {
      return NextResponse.json({ error: "A dashboard with this name already exists" }, { status: 409 })
    }

    // Deactivate others
    await prisma.dashboardLayout.updateMany({
      where: { userId },
      data: { isActive: false },
    })

    const layout = await prisma.dashboardLayout.create({
      data: {
        userId,
        name: name.trim(),
        widgets: JSON.stringify(widgets || DEFAULT_LAYOUT),
        isActive: true,
      },
    })

    return NextResponse.json({
      data: {
        id: layout.id, name: layout.name,
        widgets: JSON.parse(layout.widgets),
        isActive: layout.isActive, updatedAt: layout.updatedAt,
      }
    })
  } catch (e: any) {
    console.error("[dashboard/layout] POST error:", e)

    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

/**
 * DELETE /api/v1/dashboard/layout
 *   ?name=xxx  -> delete a specific dashboard
 *   (no name)  -> delete all (reset)
 */
export async function DELETE(req: Request) {
  const demo = demoResponse(req)
  if (demo) return demo

  try {
    const prisma = await getSessionPrisma()
    const session = await getServerSession(authOptions)
    const url = new URL(req.url)
    const userId = getUserId(session, url)
    const name = url.searchParams.get('name')

    if (name) {
      if (name === 'Default') {
        return NextResponse.json({ error: "Cannot delete the Default dashboard" }, { status: 400 })
      }

      // Delete specific dashboard
      const layout = await prisma.dashboardLayout.findFirst({ where: { userId, name } })

      if (!layout) {
        return NextResponse.json({ error: "Dashboard not found" }, { status: 404 })
      }

      await prisma.dashboardLayout.delete({ where: { id: layout.id } })

      // If we deleted the active one, activate the most recent remaining
      if (layout.isActive) {
        const next = await prisma.dashboardLayout.findFirst({
          where: { userId },
          orderBy: { updatedAt: 'desc' },
        })

        if (next) {
          await prisma.dashboardLayout.update({ where: { id: next.id }, data: { isActive: true } })
        }
      }

      return NextResponse.json({ data: { message: "Dashboard deleted", deletedName: name } })
    }

    // Delete all
    await prisma.dashboardLayout.deleteMany({ where: { userId } })

    return NextResponse.json({ data: { message: "All dashboards reset", widgets: DEFAULT_LAYOUT } })
  } catch (e: any) {
    console.error("[dashboard/layout] DELETE error:", e)

    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
