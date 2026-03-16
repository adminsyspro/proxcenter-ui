import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth/config"
import { userHasAccessToTenant } from "@/lib/tenant"
import { audit } from "@/lib/audit"
import { getDb } from "@/lib/db/sqlite"
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
  if (!userHasAccessToTenant(session.user.id, tenantId)) {
    return NextResponse.json({ error: "Access denied to this tenant" }, { status: 403 })
  }

  // Verify tenant is enabled
  const db = getDb()
  const tenant = db.prepare("SELECT id, name, enabled FROM tenants WHERE id = ?").get(tenantId) as any
  if (!tenant || !tenant.enabled) {
    return NextResponse.json({ error: "Tenant not found or disabled" }, { status: 404 })
  }

  // Update the user's default tenant
  db.prepare("UPDATE user_tenants SET is_default = 0 WHERE user_id = ?").run(session.user.id)
  db.prepare("UPDATE user_tenants SET is_default = 1 WHERE user_id = ? AND tenant_id = ?").run(session.user.id, tenantId)

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
