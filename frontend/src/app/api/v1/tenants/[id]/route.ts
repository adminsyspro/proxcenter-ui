export const dynamic = "force-dynamic"
import { NextResponse } from "next/server"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { updateTenant, deleteTenant, DEFAULT_TENANT_ID, requireProviderTenant } from "@/lib/tenant"
import { tenantWriteFailure } from "@/lib/tenant/writeFailure"
import { parseVmidRangeInput, findVmidRangeConflict } from "@/lib/tenant/vmidRange"
import { prisma } from "@/lib/db/prisma"
import { audit } from "@/lib/audit"
import { syncServiceDeskForNewTenant } from "@/lib/rbac/serviceDesk"
import { getActingSession } from "@/lib/auth/actingUser"
import { withAudit } from "@/lib/audit/withAudit"
import { withPublicApiGuard } from "@/lib/api-tokens/routeGuard"

type Ctx = { params: Promise<{ id: string }> }

// GET /api/v1/tenants/:id
async function handleGet(_req: Request, ctx: Ctx) {
  const providerGate = await requireProviderTenant()
  if (providerGate) return providerGate
  const denied = await checkPermission(PERMISSIONS.ADMIN_TENANTS_VIEW)
  if (denied) return denied

  const { id } = await ctx.params
  const row = await prisma.tenant.findUnique({ where: { id } })
  if (!row) return NextResponse.json({ error: "Tenant not found" }, { status: 404 })

  // Match the legacy SQLite shape: snake_case-ish camelCase aliases the route
  // historically returned (createdBy / createdAt / updatedAt) so consumers
  // don't have to change after the cutover.
  return NextResponse.json({
    data: {
      id: row.id,
      slug: row.slug,
      name: row.name,
      description: row.description,
      enabled: row.enabled,
      settings: row.settings,
      operatingModel: row.operatingModel,
      vmidRangeStart: row.vmidRangeStart,
      vmidRangeEnd: row.vmidRangeEnd,
      createdBy: row.createdBy,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    },
  })
}

export const GET = withPublicApiGuard("tenant-get", handleGet)

// PUT /api/v1/tenants/:id
async function handlePut(req: Request, ctx: Ctx) {
  const providerGate = await requireProviderTenant()
  if (providerGate) return providerGate
  const denied = await checkPermission(PERMISSIONS.ADMIN_TENANTS)
  if (denied) return denied

  const { id } = await ctx.params
  const body = await req.json()
  const session = await getActingSession()

  if (body.slug && !/^[a-z0-9-]+$/.test(body.slug)) {
    return NextResponse.json({ error: "slug must contain only lowercase letters, numbers, and hyphens" }, { status: 400 })
  }

  // Cannot disable default tenant
  if (id === DEFAULT_TENANT_ID && body.enabled === false) {
    return NextResponse.json({ error: "Cannot disable the default tenant" }, { status: 400 })
  }

  const rangeParse = parseVmidRangeInput(body)
  if (!rangeParse.ok) {
    return NextResponse.json({ error: rangeParse.error }, { status: 400 })
  }
  if (rangeParse.range) {
    const existing = await prisma.tenant.findUnique({ where: { id }, select: { operatingModel: true } })
    if (!existing) return NextResponse.json({ error: "Tenant not found" }, { status: 404 })
    if (existing.operatingModel !== 'msp' && existing.operatingModel !== 'iaas') {
      return NextResponse.json({ error: "A VMID range is not available on the provider tenant" }, { status: 400 })
    }
    const conflict = await findVmidRangeConflict(rangeParse.range.start, rangeParse.range.end, id)
    if (conflict) {
      return NextResponse.json(
        { error: `VMID range overlaps the range of tenant "${conflict.name}"` },
        { status: 409 }
      )
    }
  }

  try {
    const tenant = await updateTenant(id, body)
    if (!tenant) return NextResponse.json({ error: "Tenant not found" }, { status: 404 })
    // A re-enabled tenant is reached again by the service-desk roles published to all tenants (ui#1336).
    if (body.enabled === true) await syncServiceDeskForNewTenant()

    await audit({
      action: "tenant.update",
      category: "admin",
      userId: session?.user?.id,
      userEmail: session?.user?.email,
      resourceType: "tenant",
      resourceId: id,
      resourceName: tenant.name,
      details: body,
      status: "success",
    })

    return NextResponse.json({ data: tenant })
  } catch (e) {
    return tenantWriteFailure(e, "update")
  }
}

// DELETE /api/v1/tenants/:id
async function handleDelete(_req: Request, ctx: Ctx) {
  const providerGate = await requireProviderTenant()
  if (providerGate) return providerGate
  const denied = await checkPermission(PERMISSIONS.ADMIN_TENANTS)
  if (denied) return denied

  const { id } = await ctx.params
  const session = await getActingSession()

  if (id === DEFAULT_TENANT_ID) {
    return NextResponse.json({ error: "Cannot delete the default tenant" }, { status: 400 })
  }

  // The vDCs keep their tenant (foreign key): refused before anything is
  // revoked, instead of failing half-way through the delete.
  const vdcCount = await prisma.vdc.count({ where: { tenantId: id } })
  if (vdcCount > 0) {
    return NextResponse.json(
      { error: `This tenant still has ${vdcCount} vDC(s). Delete them first.`, code: "TENANT_HAS_VDCS" },
      { status: 409 }
    )
  }

  const ok = await deleteTenant(id)
  if (!ok) return NextResponse.json({ error: "Tenant not found" }, { status: 404 })

  await audit({
    action: "tenant.delete",
    category: "admin",
    userId: session?.user?.id,
    userEmail: session?.user?.email,
    resourceType: "tenant",
    resourceId: id,
    status: "success",
  })

  return NextResponse.json({ success: true })
}

export const PUT = withAudit({ category: "admin", resourceType: "tenant", resourceParam: "id" }, withPublicApiGuard("tenant-update", handlePut))
export const DELETE = withAudit({ category: "admin", resourceType: "tenant", resourceParam: "id" }, withPublicApiGuard("tenant-delete", handleDelete))
