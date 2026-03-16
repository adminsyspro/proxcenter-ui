import { NextRequest, NextResponse } from "next/server"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { getTenantUsers, addUserToTenant, removeUserFromTenant, DEFAULT_TENANT_ID } from "@/lib/tenant"
import { getDb } from "@/lib/db/sqlite"
import { audit } from "@/lib/audit"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth/config"

type Ctx = { params: Promise<{ id: string }> }

// GET /api/v1/tenants/:id/users
export async function GET(_req: NextRequest, ctx: Ctx) {
  const denied = await checkPermission(PERMISSIONS.ADMIN_TENANTS)
  if (denied) return denied

  const { id } = await ctx.params
  const users = getTenantUsers(id)
  return NextResponse.json({ data: users })
}

// POST /api/v1/tenants/:id/users — add user to tenant
export async function POST(req: NextRequest, ctx: Ctx) {
  const denied = await checkPermission(PERMISSIONS.ADMIN_TENANTS)
  if (denied) return denied

  const { id } = await ctx.params
  const body = await req.json()
  const session = await getServerSession(authOptions)

  if (!body.userId) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 })
  }

  addUserToTenant(body.userId, id, body.isDefault || false)

  // Grant a default role in this tenant (role from body, or viewer)
  const db = getDb()
  const now = new Date().toISOString()
  const roleId = body.roleId || 'role_viewer'
  const roleAssignId = `tenant_add_${id}_${body.userId}_${Date.now()}`

  // Only add if user doesn't already have a role in this tenant
  const existingRole = db.prepare(
    "SELECT 1 FROM rbac_user_roles WHERE user_id = ? AND tenant_id = ? LIMIT 1"
  ).get(body.userId, id)

  if (!existingRole) {
    db.prepare(
      `INSERT INTO rbac_user_roles (id, user_id, role_id, scope_type, tenant_id, granted_by, granted_at)
       VALUES (?, ?, ?, 'global', ?, ?, ?)`
    ).run(roleAssignId, body.userId, roleId, id, session?.user?.id || null, now)
  }

  await audit({
    action: "tenant.add_user",
    category: "admin",
    userId: session?.user?.id,
    userEmail: session?.user?.email,
    resourceType: "tenant",
    resourceId: id,
    details: { addedUserId: body.userId },
    status: "success",
  })

  return NextResponse.json({ success: true })
}

// DELETE /api/v1/tenants/:id/users — remove user from tenant
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const denied = await checkPermission(PERMISSIONS.ADMIN_TENANTS)
  if (denied) return denied

  const { id } = await ctx.params

  if (id === DEFAULT_TENANT_ID) {
    return NextResponse.json({ error: "Cannot remove users from the default tenant" }, { status: 400 })
  }

  const body = await req.json()
  const session = await getServerSession(authOptions)

  if (!body.userId) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 })
  }

  removeUserFromTenant(body.userId, id)

  await audit({
    action: "tenant.remove_user",
    category: "admin",
    userId: session?.user?.id,
    userEmail: session?.user?.email,
    resourceType: "tenant",
    resourceId: id,
    details: { removedUserId: body.userId },
    status: "success",
  })

  return NextResponse.json({ success: true })
}
