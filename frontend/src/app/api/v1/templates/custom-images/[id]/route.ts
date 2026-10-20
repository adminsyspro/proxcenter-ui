// src/app/api/v1/templates/custom-images/[id]/route.ts
import { NextResponse } from "next/server"

import { getSessionPrisma, getCurrentTenantId, DEFAULT_TENANT_ID } from "@/lib/tenant"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { updateCustomImageSchema } from "@/lib/schemas"
import { authorizeImageLocations, authorizeImageVolume, extraImageLocations, SourceVolumeError } from '@/lib/templates/sourceVolume'
import { loadGrantSummary, replaceTenantGrants } from '@/lib/templates/catalogGrants'
import { isNodeUrlFetchRefused, URL_IMAGE_REFUSED } from '@/lib/vdc/nodeUrlFetch'
import { withAudit } from "@/lib/audit/withAudit"

export const runtime = "nodejs"

interface Ctx { params: Promise<{ id: string }> }

export async function GET(req: Request, ctx: Ctx) {
  try {
    const prisma = await getSessionPrisma()
    const denied = await checkPermission(PERMISSIONS.VM_VIEW)
    if (denied) return denied

    const { id } = await ctx.params
    const image = await prisma.customImage.findUnique({ where: { id } })
    if (!image) return NextResponse.json({ error: "Not found" }, { status: 404 })

    const tenantId = await getCurrentTenantId()
    if (tenantId !== DEFAULT_TENANT_ID) return NextResponse.json({ data: image })
    return NextResponse.json({ data: { ...image, grants: await loadGrantSummary('image', image.id) } })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

async function handlePut(req: Request, ctx: Ctx) {
  try {
    const prisma = await getSessionPrisma()
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
    // isShared can only be toggled by the provider (tenant 'default').
    // Strip it from any other tenant's update payload to keep the catalogue
    // sharing decision in provider hands.
    const tenantId = await getCurrentTenantId()
    const data: any = { ...body }
    const source = { ...existing, ...body }
    const sourceTouched = ['sourceType', 'volumeId', 'sourceConnectionId', 'sourceNode', 'format', 'extraLocations']
      .some(key => (body as Record<string, unknown>)[key] !== undefined)
    if (source.sourceType === 'volume') {
      // A metadata edit (name, memory...) must not depend on the source
      // cluster being reachable or the volume still existing: the source was
      // authorised when it was set and is checked again at deploy time.
      if (sourceTouched) {
        await authorizeImageVolume({ tenantId, source })
        await authorizeImageLocations({ tenantId, source, locations: extraImageLocations(source) })
      }
    } else {
      // Setting or changing the URL a node will fetch: refused to a vDC tenant
      // like at creation. A metadata edit of an existing URL image goes through.
      const urlTouched = ['sourceType', 'downloadUrl'].some(key => (body as Record<string, unknown>)[key] !== undefined)
      if (urlTouched && await isNodeUrlFetchRefused(tenantId)) {
        return NextResponse.json({ error: URL_IMAGE_REFUSED }, { status: 403 })
      }
      data.sourceConnectionId = null
      data.sourceNode = null
      data.volumeId = null
      data.extraLocations = []
    }
    if (data.isShared !== undefined && tenantId !== DEFAULT_TENANT_ID) {
      delete data.isShared
    }
    // Per-tenant grants (#903) are provider-only too; the field never reaches
    // the row, it is a separate table.
    const grantTenantIds: string[] | undefined = data.grantTenantIds
    delete data.grantTenantIds
    const image = await prisma.customImage.update({
      where: { id },
      data,
    })
    if (grantTenantIds && tenantId === DEFAULT_TENANT_ID) {
      await replaceTenantGrants('image', image.id, grantTenantIds, null)
    }

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
    if (e instanceof SourceVolumeError) return NextResponse.json({ error: e.message }, { status: e.status })
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

async function handleDelete(req: Request, ctx: Ctx) {
  try {
    const prisma = await getSessionPrisma()
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

export const PUT = withAudit({ category: "templates", resourceType: "custom_image", resourceParam: "id" }, handlePut)
export const DELETE = withAudit({ category: "templates", resourceType: "custom_image", resourceParam: "id" }, handleDelete)
