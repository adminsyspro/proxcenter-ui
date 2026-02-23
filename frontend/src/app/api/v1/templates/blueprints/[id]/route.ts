// src/app/api/v1/templates/blueprints/[id]/route.ts
import { NextResponse } from "next/server"

import { prisma } from "@/lib/db/prisma"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { createBlueprintSchema } from "@/lib/schemas"

export const runtime = "nodejs"

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> | { id: string } }) {
  try {
    const params = await Promise.resolve(ctx.params)
    const id = (params as any)?.id
    if (!id) return NextResponse.json({ error: "Missing params.id" }, { status: 400 })

    const denied = await checkPermission(PERMISSIONS.VM_VIEW)
    if (denied) return denied

    const blueprint = await prisma.blueprint.findUnique({ where: { id } })
    if (!blueprint) return NextResponse.json({ error: "Blueprint not found" }, { status: 404 })

    return NextResponse.json({ data: blueprint })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

export async function PUT(req: Request, ctx: { params: Promise<{ id: string }> | { id: string } }) {
  try {
    const params = await Promise.resolve(ctx.params)
    const id = (params as any)?.id
    if (!id) return NextResponse.json({ error: "Missing params.id" }, { status: 400 })

    const denied = await checkPermission(PERMISSIONS.VM_CREATE)
    if (denied) return denied

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

    const blueprint = await prisma.blueprint.update({
      where: { id },
      data: {
        name: d.name,
        description: d.description ?? null,
        imageSlug: d.imageSlug,
        hardware: JSON.stringify(d.hardware),
        cloudInit: d.cloudInit ? JSON.stringify(d.cloudInit) : null,
        tags: d.tags ?? null,
        isPublic: d.isPublic,
      },
    })

    const { audit } = await import("@/lib/audit")
    await audit({
      action: "update",
      category: "templates",
      resourceType: "global",
      resourceId: blueprint.id,
      resourceName: blueprint.name,
      status: "success",
    })

    return NextResponse.json({ data: blueprint })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

export async function DELETE(_req: Request, ctx: { params: Promise<{ id: string }> | { id: string } }) {
  try {
    const params = await Promise.resolve(ctx.params)
    const id = (params as any)?.id
    if (!id) return NextResponse.json({ error: "Missing params.id" }, { status: 400 })

    const denied = await checkPermission(PERMISSIONS.VM_CREATE)
    if (denied) return denied

    const blueprint = await prisma.blueprint.findUnique({ where: { id }, select: { name: true } })

    await prisma.blueprint.delete({ where: { id } })

    const { audit } = await import("@/lib/audit")
    await audit({
      action: "delete",
      category: "templates",
      resourceType: "global",
      resourceId: id,
      resourceName: blueprint?.name,
      status: "success",
    })

    return NextResponse.json({ ok: true })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
