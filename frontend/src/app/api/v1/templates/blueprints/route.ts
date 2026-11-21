// src/app/api/v1/templates/blueprints/route.ts
import { NextResponse } from "next/server"

import { getSessionPrisma, getCurrentTenantId, DEFAULT_TENANT_ID } from "@/lib/tenant"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { getActingSession } from "@/lib/auth/actingUser"
import { withPublicApiGuard } from "@/lib/api-tokens/routeGuard"
import { withoutCloudInitSecrets } from "@/lib/templates/blueprintSecrets"
import { createBlueprintSchema } from "@/lib/schemas"
import { listVisibleBlueprints, loadGrantSummaries, replaceTenantGrants } from "@/lib/templates/catalogGrants"
import { withAudit } from "@/lib/audit/withAudit"

export const runtime = "nodejs"

async function handleGet() {
  try {
    const denied = await checkPermission(PERMISSIONS.VM_VIEW)
    if (denied) return denied

    // Own rows, plus the provider blueprints shared with everyone or granted
    // to this tenant / the vDC in view (#903). The provider only ever sees
    // its own rows and gets their grants for the visibility column.
    const tenantId = await getCurrentTenantId()
    const rows = await listVisibleBlueprints(tenantId)
    const isProvider = tenantId === DEFAULT_TENANT_ID
    const grants = isProvider ? await loadGrantSummaries('blueprint', rows.map(r => r.id)) : new Map()
    const blueprints = rows.map(row => ({
      ...withoutCloudInitSecrets(row),
      ownedByCaller: row.tenantId === tenantId,
      ...(isProvider ? { grants: grants.get(row.id) ?? { tenantIds: [], vdcIds: [] } } : {}),
    }))

    return NextResponse.json({ data: blueprints })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}

async function handlePost(req: Request) {
  try {
    const prisma = await getSessionPrisma()
    const denied = await checkPermission(PERMISSIONS.VM_CREATE)
    if (denied) return denied

    const session = await getActingSession()
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

    const blueprint = await prisma.blueprint.create({
      data: {
        name: d.name,
        description: d.description ?? null,
        imageSlug: d.imageSlug,
        hardware: d.hardware,
        cloudInit: d.cloudInit ?? null,
        tags: d.tags ?? null,
        isPublic: d.isPublic,
        // Sharing and granting are provider decisions (#903); a tenant's
        // request silently keeps its blueprint private, as for images.
        isShared: isProvider && d.isShared === true,
        createdBy: session?.user?.id || null,
      },
    })
    if (isProvider && d.grantTenantIds) {
      await replaceTenantGrants('blueprint', blueprint.id, d.grantTenantIds, session?.user?.id || null)
    }

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

export const POST = withAudit({ category: "templates", resourceType: "blueprint" }, handlePost)
export const GET = withPublicApiGuard("templates-blueprints", handleGet)
