// src/app/api/v1/templates/custom-images/[id]/route.ts
import { NextResponse } from "next/server"

import { prisma } from "@/lib/db/prisma"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { updateCustomImageSchema } from "@/lib/schemas"

export const runtime = "nodejs"

interface Ctx { params: Promise<{ id: string }> }

export async function GET(req: Request, ctx: Ctx) {
  try {
    const denied = await checkPermission(PERMISSIONS.VM_VIEW)
    if (denied) return denied

    const { id } = await ctx.params
    const image = await prisma.customImage.findUnique({ where: { id } })
    if (!image) return NextResponse.json({ error: "Not found" }, { status: 404 })

    return NextResponse.json({ data: image })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

export async function PUT(req: Request, ctx: Ctx) {
  try {
    const denied = await checkPermission(PERMISSIONS.VM_CREATE)
    if (denied) return denied

    const { id } = await ctx.params
    const existing = await prisma.customImage.findUnique({ where: { id } })
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const rawBody = await req.json().catch(() => null)
    if (!rawBody) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })

    const parseResult = updateCustomImageSchema.safeParse(rawBody)
    if (!parseResult.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parseResult.error.flatten() },
        { status: 400 }
      )
    }

    const body = parseResult.data
    const image = await prisma.customImage.update({
      where: { id },
      data: body,
    })

    const { audit } = await import("@/lib/audit")
    await audit({
      action: "update",
      category: "templates",
      resourceType: "custom_image",
      resourceId: image.id,
      resourceName: image.name,
      details: { slug: image.slug },
      status: "success",
    })

    return NextResponse.json({ data: image })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

export async function DELETE(req: Request, ctx: Ctx) {
  try {
    const denied = await checkPermission(PERMISSIONS.VM_CREATE)
    if (denied) return denied

    const { id } = await ctx.params
    const existing = await prisma.customImage.findUnique({ where: { id } })
    if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 })

    await prisma.customImage.delete({ where: { id } })

    const { audit } = await import("@/lib/audit")
    await audit({
      action: "delete",
      category: "templates",
      resourceType: "custom_image",
      resourceId: existing.id,
      resourceName: existing.name,
      details: { slug: existing.slug },
      status: "success",
    })

    return NextResponse.json({ data: { ok: true } })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
