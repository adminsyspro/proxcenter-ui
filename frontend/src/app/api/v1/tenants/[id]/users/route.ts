export const dynamic = "force-dynamic"
import { NextResponse } from "next/server"
import { checkPermission, PERMISSIONS, isUserSuperAdmin } from "@/lib/rbac"
import { guardRoleAssignment } from "@/lib/rbac/assignmentGuards"
import { DEFAULT_TENANT_ID, getTenantUsers, addUserToTenant, removeUserFromTenant, TenantMembershipError, requireProviderTenant } from "@/lib/tenant"
import { prisma } from "@/lib/db/prisma"
import { audit } from "@/lib/audit"
import { getActingSession, getTokenCaller } from "@/lib/auth/actingUser"
import { denyIfTargetIsProtectedAndCallerIsNot } from "@/lib/rbac/userTargetGuards"
import { withAudit } from "@/lib/audit/withAudit"
import { withPublicApiGuard } from "@/lib/api-tokens/routeGuard"

type Ctx = { params: Promise<{ id: string }> }

/**
 * An API token (tenants:write) is never a super admin: it leaves provider
 * operators alone, and it never moves its own creator in or out of a tenant,
 * which would hand the creator a role there.
 */
async function refuseTokenTarget(userId: string): Promise<NextResponse | null> {
  const tokenCaller = await getTokenCaller()
  if (!tokenCaller) return null
  if (userId === tokenCaller.creatorUserId) {
    return NextResponse.json({ error: "An API token cannot change the memberships of its creator" }, { status: 403 })
  }
  return denyIfTargetIsProtectedAndCallerIsNot(userId, undefined)
}

// GET /api/v1/tenants/:id/users
async function handleGet(_req: Request, ctx: Ctx) {
  const providerGate = await requireProviderTenant()
  if (providerGate) return providerGate
  const denied = await checkPermission(PERMISSIONS.ADMIN_TENANTS_VIEW)
  if (denied) return denied

  const { id } = await ctx.params
  const users = await getTenantUsers(id)
  return NextResponse.json({ data: users })
}

export const GET = withPublicApiGuard("tenant-users-list", handleGet)

// POST /api/v1/tenants/:id/users — add user to tenant
async function handlePost(req: Request, ctx: Ctx) {
  const providerGate = await requireProviderTenant()
  if (providerGate) return providerGate
  const denied = await checkPermission(PERMISSIONS.ADMIN_TENANTS)
  if (denied) return denied

  const { id } = await ctx.params
  const body = await req.json()
  const session = await getActingSession()

  if (!body.userId || typeof body.userId !== "string") {
    return NextResponse.json({ error: "userId is required" }, { status: 400 })
  }

  const tokenRefusal = await refuseTokenTarget(body.userId)
  if (tokenRefusal) return tokenRefusal

  const target = await prisma.user.findUnique({ where: { id: body.userId }, select: { id: true } })
  if (!target) return NextResponse.json({ error: "User not found" }, { status: 404 })

  // The role granted below comes straight from the body, so it obeys the
  // rules of every grant (lib/rbac/assignmentGuards.ts), checked before the
  // membership is written so a refusal leaves nothing behind.
  // No role named (TenantsTab sends none): the viewer role of the tenant's
  // kind, role_viewer being provider-only.
  const defaultRoleId = id === DEFAULT_TENANT_ID ? "role_viewer" : "role_tenant_viewer"
  const roleId = typeof body.roleId === "string" && body.roleId ? body.roleId : defaultRoleId
  const guard = await guardRoleAssignment({ callerUserId: session?.user?.id ?? "", roleId, targetTenantId: id })
  if (!guard.ok) return guard.response!

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
async function handleDelete(req: Request, ctx: Ctx) {
  const providerGate = await requireProviderTenant()
  if (providerGate) return providerGate
  const denied = await checkPermission(PERMISSIONS.ADMIN_TENANTS)
  if (denied) return denied

  const { id } = await ctx.params
  // The member comes in the query string (API clients) or in the body (the UI).
  const body = { userId: new URL(req.url).searchParams.get("userId") || (await req.json().catch(() => null))?.userId }
  const session = await getActingSession()

  if (!body.userId || typeof body.userId !== "string") {
    return NextResponse.json({ error: "userId is required" }, { status: 400 })
  }

  const tokenRefusal = await refuseTokenTarget(body.userId)
  if (tokenRefusal) return tokenRefusal

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

export const POST = withAudit({ category: "admin", resourceType: "tenant", resourceParam: "id" }, withPublicApiGuard("tenant-user-add", handlePost))
export const DELETE = withAudit({ category: "admin", resourceType: "tenant", resourceParam: "id" }, withPublicApiGuard("tenant-user-remove", handleDelete))
