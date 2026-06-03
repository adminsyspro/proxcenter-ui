export const dynamic = "force-dynamic"
import { NextRequest, NextResponse } from "next/server"
import { checkPermission, PERMISSIONS, isUserSuperAdmin } from "@/lib/rbac"
import { getTenantUsers, addUserToTenant, removeUserFromTenant, TenantMembershipError, requireProviderTenant } from "@/lib/tenant"
import { prisma } from "@/lib/db/prisma"
import { audit } from "@/lib/audit"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth/config"

type Ctx = { params: Promise<{ id: string }> }

// GET /api/v1/tenants/:id/users
export async function GET(_req: NextRequest, ctx: Ctx) {
  const providerGate = await requireProviderTenant()
  if (providerGate) return providerGate
  const denied = await checkPermission(PERMISSIONS.ADMIN_TENANTS)
  if (denied) return denied

  const { id } = await ctx.params
  const users = await getTenantUsers(id)
  return NextResponse.json({ data: users })
}

// POST /api/v1/tenants/:id/users — add user to tenant
export async function POST(req: NextRequest, ctx: Ctx) {
  const providerGate = await requireProviderTenant()
  if (providerGate) return providerGate
  const denied = await checkPermission(PERMISSIONS.ADMIN_TENANTS)
  if (denied) return denied

  const { id } = await ctx.params
  const body = await req.json()
  const session = await getServerSession(authOptions)

  if (!body.userId) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 })
  }

  await addUserToTenant(body.userId, id, body.isDefault || false)

  // Grant a default role in this tenant (role from body, or viewer).
  // Super-admins are excluded: their global role_super_admin already grants
  // wildcard access in every tenant, so a per-tenant role would either be
  // misleading (role_viewer chip on a super-admin) or redundant.
  const roleId = body.roleId || 'role_viewer'
  const roleAssignId = `tenant_add_${id}_${body.userId}_${Date.now()}`

  const targetIsSuperAdmin = await isUserSuperAdmin(body.userId)
  const existingRole = await prisma.rbacUserRole.findFirst({
    where: { userId: body.userId, tenantId: id },
    select: { id: true },
  })

  if (!existingRole && !targetIsSuperAdmin) {
    await prisma.rbacUserRole.create({
      data: {
        id: roleAssignId,
        userId: body.userId,
        roleId,
        // inherit so the assignment follows the role's default scope (issue #383)
        scopeType: 'inherit',
        tenantId: id,
        grantedById: session?.user?.id || null,
        grantedAt: new Date(),
      },
    })
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
  const providerGate = await requireProviderTenant()
  if (providerGate) return providerGate
  const denied = await checkPermission(PERMISSIONS.ADMIN_TENANTS)
  if (denied) return denied

  const { id } = await ctx.params
  const body = await req.json()
  const session = await getServerSession(authOptions)

  if (!body.userId) {
    return NextResponse.json({ error: "userId is required" }, { status: 400 })
  }

  try {
    await removeUserFromTenant(body.userId, id)
  } catch (e) {
    if (e instanceof TenantMembershipError) {
      const status = e.code === "LAST_TENANT" ? 409 : e.code === "SUPER_ADMIN_PROTECTED" ? 403 : 404
      return NextResponse.json({ error: e.message, code: e.code }, { status })
    }
    throw e
  }

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
