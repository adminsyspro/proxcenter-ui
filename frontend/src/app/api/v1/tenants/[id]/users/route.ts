export const dynamic = "force-dynamic"
import { NextRequest, NextResponse } from "next/server"
import { checkPermission, PERMISSIONS, isUserSuperAdmin, PROTECTED_ROLE_IDS, PROVIDER_ONLY_ROLE_IDS } from "@/lib/rbac"
import { DEFAULT_TENANT_ID, getTenantUsers, addUserToTenant, removeUserFromTenant, TenantMembershipError, requireProviderTenant } from "@/lib/tenant"
import { prisma } from "@/lib/db/prisma"
import { audit } from "@/lib/audit"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth/config"
import { withAudit } from "@/lib/audit/withAudit"

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
async function handlePost(req: NextRequest, ctx: Ctx) {
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

  // The role granted below comes straight from the body, so it obeys the same
  // rules as POST /rbac/assignments, and before the membership is written so a
  // refusal leaves nothing behind: provider-only and protected roles never
  // land in a customer tenant, protected roles come from a super admin only
  // (and read as unknown to anyone else), and the role has to exist.
  // No role named (TenantsTab sends none): the viewer role of the tenant's
  // kind, role_viewer being provider-only.
  const defaultRoleId = id === DEFAULT_TENANT_ID ? "role_viewer" : "role_tenant_viewer"
  const roleId = typeof body.roleId === "string" && body.roleId ? body.roleId : defaultRoleId
  const tenantForbiddenRoles = [...PROVIDER_ONLY_ROLE_IDS, ...PROTECTED_ROLE_IDS] as readonly string[]
  if (id !== DEFAULT_TENANT_ID && tenantForbiddenRoles.includes(roleId)) {
    return NextResponse.json(
      { error: "This role can only be assigned in the provider tenant (default)" },
      { status: 400 },
    )
  }
  const callerIsSuperAdmin = session?.user?.id ? await isUserSuperAdmin(session.user.id) : false
  if (!callerIsSuperAdmin && (PROTECTED_ROLE_IDS as readonly string[]).includes(roleId)) {
    return NextResponse.json({ error: "Role not found" }, { status: 404 })
  }
  const role = await prisma.rbacRole.findUnique({ where: { id: roleId }, select: { id: true } })
  if (!role) {
    return NextResponse.json({ error: "Role not found" }, { status: 404 })
  }

  await addUserToTenant(body.userId, id, body.isDefault || false)

  // Grant a default role in this tenant (role from body, or viewer).
  // Super-admins are excluded: their global role_super_admin already grants
  // wildcard access in every tenant, so a per-tenant role would either be
  // misleading (role_viewer chip on a super-admin) or redundant.
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
async function handleDelete(req: NextRequest, ctx: Ctx) {
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

export const POST = withAudit({ category: "admin", resourceType: "tenant", resourceParam: "id" }, handlePost)
export const DELETE = withAudit({ category: "admin", resourceType: "tenant", resourceParam: "id" }, handleDelete)
