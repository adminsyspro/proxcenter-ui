export const dynamic = "force-dynamic"
import { NextRequest, NextResponse } from "next/server"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { updateTenant, deleteTenant, DEFAULT_TENANT_ID, requireProviderTenant } from "@/lib/tenant"
import { parseVmidRangeInput, findVmidRangeConflict } from "@/lib/tenant/vmidRange"
import { prisma } from "@/lib/db/prisma"
import { audit } from "@/lib/audit"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth/config"

type Ctx = { params: Promise<{ id: string }> }

// GET /api/v1/tenants/:id
export async function GET(_req: NextRequest, ctx: Ctx) {
  const providerGate = await requireProviderTenant()
  if (providerGate) return providerGate
  const denied = await checkPermission(PERMISSIONS.ADMIN_TENANTS)
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

// PUT /api/v1/tenants/:id
export async function PUT(req: NextRequest, ctx: Ctx) {
  const providerGate = await requireProviderTenant()
  if (providerGate) return providerGate
  const denied = await checkPermission(PERMISSIONS.ADMIN_TENANTS)
  if (denied) return denied

  const { id } = await ctx.params
  const body = await req.json()
  const session = await getServerSession(authOptions)

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
    if (existing.operatingModel !== 'msp') {
      return NextResponse.json({ error: "A VMID range is only available for MSP tenants" }, { status: 400 })
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
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}

// DELETE /api/v1/tenants/:id
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const providerGate = await requireProviderTenant()
  if (providerGate) return providerGate
  const denied = await checkPermission(PERMISSIONS.ADMIN_TENANTS)
  if (denied) return denied

  const { id } = await ctx.params
  const session = await getServerSession(authOptions)

  if (id === DEFAULT_TENANT_ID) {
    return NextResponse.json({ error: "Cannot delete the default tenant" }, { status: 400 })
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
