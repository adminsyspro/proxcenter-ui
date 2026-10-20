// src/app/api/v1/templates/blueprints/[id]/route.ts
import { NextResponse } from "next/server"

import { getSessionPrisma, getCurrentTenantId, DEFAULT_TENANT_ID } from "@/lib/tenant"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { createBlueprintSchema } from "@/lib/schemas"
import { findBlueprintForTenant, loadGrantSummary, replaceTenantGrants } from "@/lib/templates/catalogGrants"
import { withAudit } from "@/lib/audit/withAudit"

export const runtime = "nodejs"

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> | { id: string } }) {
  try {
    const params = await Promise.resolve(ctx.params)
    const id = (params as any)?.id
    if (!id) return NextResponse.json({ error: "Missing params.id" }, { status: 400 })

    const denied = await checkPermission(PERMISSIONS.VM_VIEW)
    if (denied) return denied

    // Same scope as the list (#903): own, shared, or granted.
    const tenantId = await getCurrentTenantId()
    const blueprint = await findBlueprintForTenant(tenantId, id)
    if (!blueprint) return NextResponse.json({ error: "Blueprint not found" }, { status: 404 })

    const ownedByCaller = blueprint.tenantId === tenantId
    const grants = tenantId === DEFAULT_TENANT_ID ? await loadGrantSummary('blueprint', id) : undefined
    return NextResponse.json({ data: { ...blueprint, ownedByCaller, ...(grants ? { grants } : {}) } })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

async function handlePut(req: Request, ctx: { params: Promise<{ id: string }> | { id: string } }) {
  try {
    const prisma = await getSessionPrisma()
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
    const tenantId = await getCurrentTenantId()
    const isProvider = tenantId === DEFAULT_TENANT_ID

    // The tenant-scoped client refuses a row the caller does not own, so a
    // tenant can never edit a blueprint it only sees through a grant.
    const blueprint = await prisma.blueprint.update({
      where: { id },
      data: {
        name: d.name,
        description: d.description ?? null,
        imageSlug: d.imageSlug,
        hardware: d.hardware,
        cloudInit: d.cloudInit ?? null,
        tags: d.tags ?? null,
        isPublic: d.isPublic,
        ...(isProvider && d.isShared !== undefined ? { isShared: d.isShared } : {}),
      },
    })
    if (isProvider && d.grantTenantIds) {
      await replaceTenantGrants('blueprint', blueprint.id, d.grantTenantIds, null)
    }

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
    // A granted or shared blueprint is listed for the tenant but owned by the
    // provider: the scoped client refuses the write, answer 404 rather than 500.
    if (e?.message === 'Record not found') return NextResponse.json({ error: "Blueprint not found" }, { status: 404 })
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

async function handleDelete(_req: Request, ctx: { params: Promise<{ id: string }> | { id: string } }) {
  try {
    const prisma = await getSessionPrisma()
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
    if (e?.message === 'Record not found') return NextResponse.json({ error: "Blueprint not found" }, { status: 404 })
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

export const PUT = withAudit({ category: "templates", resourceType: "blueprint", resourceParam: "id" }, handlePut)
export const DELETE = withAudit({ category: "templates", resourceType: "blueprint", resourceParam: "id" }, handleDelete)
