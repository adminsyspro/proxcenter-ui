// src/app/api/v1/templates/blueprints/route.ts
import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"

import { prisma } from "@/lib/db/prisma"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { authOptions } from "@/lib/auth/config"
import { createBlueprintSchema } from "@/lib/schemas"

export const runtime = "nodejs"

export async function GET() {
  try {
    const denied = await checkPermission(PERMISSIONS.VM_VIEW)
    if (denied) return denied

    const blueprints = await prisma.blueprint.findMany({
      orderBy: { createdAt: "desc" },
    })

    return NextResponse.json({ data: blueprints })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const denied = await checkPermission(PERMISSIONS.VM_CREATE)
    if (denied) return denied

    const session = await getServerSession(authOptions)
    const rawBody = await req.json().catch(() => null)
    if (!rawBody) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })

    const parseResult = createBlueprintSchema.safeParse(rawBody)
    if (!parseResult.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parseResult.error.flatten() },
        { status: 400 }
      )
    }

    const d = parseResult.data

    const blueprint = await prisma.blueprint.create({
      data: {
        name: d.name,
        description: d.description ?? null,
        imageSlug: d.imageSlug,
        hardware: JSON.stringify(d.hardware),
        cloudInit: d.cloudInit ? JSON.stringify(d.cloudInit) : null,
        tags: d.tags ?? null,
        isPublic: d.isPublic,
        createdBy: session?.user?.id || null,
      },
    })

    const { audit } = await import("@/lib/audit")
    await audit({
      action: "create",
      category: "templates",
      resourceType: "global",
      resourceId: blueprint.id,
      resourceName: blueprint.name,
      details: { imageSlug: blueprint.imageSlug },
      status: "success",
    })

    return NextResponse.json({ data: blueprint }, { status: 201 })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
