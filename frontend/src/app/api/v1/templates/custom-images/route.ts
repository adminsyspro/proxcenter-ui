// src/app/api/v1/templates/custom-images/route.ts
import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"

import { getSessionPrisma, getCurrentTenantId } from "@/lib/tenant"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { authOptions } from "@/lib/auth/config"
import { createCustomImageSchema } from "@/lib/schemas"

export const runtime = "nodejs"

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

export async function GET(req: Request) {
  try {
    const prisma = await getSessionPrisma()
    const denied = await checkPermission(PERMISSIONS.VM_VIEW)
    if (denied) return denied

    const images = await prisma.customImage.findMany({
      orderBy: { createdAt: 'desc' },
    })

    return NextResponse.json({ data: images })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

export async function POST(req: Request) {
  try {
    const prisma = await getSessionPrisma()
    const denied = await checkPermission(PERMISSIONS.VM_CREATE)
    if (denied) return denied

    const session = await getServerSession(authOptions)
    const rawBody = await req.json().catch(() => null)
    if (!rawBody) return NextResponse.json({ error: "Invalid JSON" }, { status: 400 })

    const parseResult = createCustomImageSchema.safeParse(rawBody)
    if (!parseResult.success) {
      return NextResponse.json(
        { error: "Invalid input", details: parseResult.error.flatten() },
        { status: 400 }
      )
    }

    const body = parseResult.data

    const tenantId = await getCurrentTenantId()

    // Generate unique slug
    let baseSlug = slugify(body.name)
    if (!baseSlug) baseSlug = 'custom-image'
    // Prefix with "custom-" to avoid collision with built-in slugs
    baseSlug = `custom-${baseSlug}`
    let slug = baseSlug
    let suffix = 0
    while (await prisma.customImage.findUnique({ where: { tenantId_slug: { tenantId, slug } } })) {
      suffix++
      slug = `${baseSlug}-${suffix}`
    }

    const image = await prisma.customImage.create({
      data: {
        slug,
        name: body.name,
        vendor: body.vendor,
        version: body.version,
        arch: body.arch,
        format: body.format,
        sourceType: body.sourceType,
        downloadUrl: body.downloadUrl || null,
        checksumUrl: body.checksumUrl || null,
        volumeId: body.volumeId || null,
        defaultDiskSize: body.defaultDiskSize,
        minMemory: body.minMemory,
        recommendedMemory: body.recommendedMemory,
        minCores: body.minCores,
        recommendedCores: body.recommendedCores,
        ostype: body.ostype,
        tags: body.tags || null,
        createdBy: session?.user?.id || null,
      },
    })

    // Audit
    const { audit } = await import("@/lib/audit")
    await audit({
      action: "create",
      category: "templates",
      resourceType: "custom_image",
      resourceId: image.id,
      resourceName: image.name,
      details: { slug: image.slug, sourceType: image.sourceType },
      status: "success",
    })

    return NextResponse.json({ data: image }, { status: 201 })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
