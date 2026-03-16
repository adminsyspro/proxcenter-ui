import { NextRequest, NextResponse } from "next/server"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { updateTenant, deleteTenant, DEFAULT_TENANT_ID } from "@/lib/tenant"
import { getDb } from "@/lib/db/sqlite"
import { audit } from "@/lib/audit"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth/config"

type Ctx = { params: Promise<{ id: string }> }

// GET /api/v1/tenants/:id
export async function GET(_req: NextRequest, ctx: Ctx) {
  const denied = await checkPermission(PERMISSIONS.ADMIN_TENANTS)
  if (denied) return denied

  const { id } = await ctx.params
  const db = getDb()
  const tenant = db.prepare(
    "SELECT id, slug, name, description, enabled, settings, created_by as createdBy, created_at as createdAt, updated_at as updatedAt FROM tenants WHERE id = ?"
  ).get(id)

  if (!tenant) return NextResponse.json({ error: "Tenant not found" }, { status: 404 })
  return NextResponse.json({ data: tenant })
}

// PUT /api/v1/tenants/:id
export async function PUT(req: NextRequest, ctx: Ctx) {
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

  try {
    const tenant = updateTenant(id, body)
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
  const denied = await checkPermission(PERMISSIONS.ADMIN_TENANTS)
  if (denied) return denied

  const { id } = await ctx.params
  const session = await getServerSession(authOptions)

  if (id === DEFAULT_TENANT_ID) {
    return NextResponse.json({ error: "Cannot delete the default tenant" }, { status: 400 })
  }

  const ok = deleteTenant(id)
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
