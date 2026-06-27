export const dynamic = "force-dynamic"
import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth/config"
import { userHasAccessToTenant } from "@/lib/tenant"
import { audit } from "@/lib/audit"
import { prisma } from "@/lib/db/prisma"
import { invalidateInventoryCache } from "@/lib/cache/inventoryCache"
import { invalidateNodeIpCache } from "@/lib/cache/nodeIpCache"
import { invalidateConnectionCache } from "@/lib/connections/getConnection"

// POST /api/v1/auth/switch-tenant
// Switches the user's active tenant by updating the JWT cookie.
// The actual JWT update happens on next session refresh — this endpoint
// validates the switch and updates the user_tenants default.
export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const body = await req.json()
  const { tenantId } = body

  if (!tenantId) {
    return NextResponse.json({ error: "tenantId is required" }, { status: 400 })
  }

  // Verify user has access to the target tenant
  if (!(await userHasAccessToTenant(session.user.id, tenantId))) {
    return NextResponse.json({ error: "Access denied to this tenant" }, { status: 403 })
  }

  // Verify tenant is enabled
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { id: true, name: true, enabled: true },
  })
  if (!tenant || !tenant.enabled) {
    return NextResponse.json({ error: "Tenant not found or disabled" }, { status: 404 })
  }

  // Update the user's default tenant: clear any other default, mark this one.
  // Wrapped in a transaction so a partial failure can't leave a user with
  // zero or two default memberships.
  //
  // The target membership is upserted, not just updated: a super-admin sees
  // every tenant in the switcher (cross-tenant access by design) but only has
  // a user_tenants row for tenants created while they were already super-admin
  // (createTenant auto-attaches them). Without the create branch, switching to
  // a tenant the user has no row for updated zero rows, left no default, and
  // silently fell back to `default`. userHasAccessToTenant already authorised
  // the target above, so creating the row here is safe.
  await prisma.$transaction([
    prisma.userTenant.updateMany({
      where: { userId: session.user.id },
      data: { isDefault: false },
    }),
    prisma.userTenant.upsert({
      where: { userId_tenantId: { userId: session.user.id, tenantId } },
      update: { isDefault: true },
      create: { userId: session.user.id, tenantId, isDefault: true, joinedAt: new Date() },
    }),
  ])

  // Invalidate all server-side caches to prevent data leaks between tenants
  invalidateInventoryCache()
  invalidateNodeIpCache()
  invalidateConnectionCache()

  await audit({
    action: "tenant.switch",
    category: "auth",
    userId: session.user.id,
    userEmail: session.user.email,
    resourceType: "tenant",
    resourceId: tenantId,
    resourceName: tenant.name,
    status: "success",
  })

  // The client should trigger a session refresh (signIn again or update session)
  // to get the new tenantId in the JWT
  return NextResponse.json({
    success: true,
    tenantId,
    tenantName: tenant.name,
    message: "Tenant switched. Please refresh the page to apply.",
  })
}
