export const dynamic = "force-dynamic"
import { NextRequest, NextResponse } from "next/server"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { listTenants, createTenant, addUserToTenant } from "@/lib/tenant"
import { getDb } from "@/lib/db/sqlite"
import { audit } from "@/lib/audit"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth/config"

// GET /api/v1/tenants — list all tenants (admin only)
export async function GET() {
  const denied = await checkPermission(PERMISSIONS.ADMIN_TENANTS)
  if (denied) return denied

  const tenants = listTenants()
  return NextResponse.json({ data: tenants })
}

// POST /api/v1/tenants — create a new tenant
export async function POST(req: NextRequest) {
  const denied = await checkPermission(PERMISSIONS.ADMIN_TENANTS)
  if (denied) return denied

  const session = await getServerSession(authOptions)
  const body = await req.json()

  if (!body.name || !body.slug) {
    return NextResponse.json({ error: "name and slug are required" }, { status: 400 })
  }

  // Validate slug format
  if (!/^[a-z0-9-]+$/.test(body.slug)) {
    return NextResponse.json({ error: "slug must contain only lowercase letters, numbers, and hyphens" }, { status: 400 })
  }

  try {
    const tenant = createTenant({
      slug: body.slug,
      name: body.name,
      description: body.description,
      createdBy: session?.user?.id,
    })

    // Auto-assign the creator to the new tenant with super_admin role
    if (session?.user?.id) {
      addUserToTenant(session.user.id, tenant.id)

      // Grant super_admin role in the new tenant
      const db = getDb()
      const now = new Date().toISOString()
      const roleAssignId = `tenant_create_${tenant.id}_${Date.now()}`
      db.prepare(
        `INSERT OR IGNORE INTO rbac_user_roles (id, user_id, role_id, scope_type, tenant_id, granted_at)
         VALUES (?, ?, 'role_super_admin', 'global', ?, ?)`
      ).run(roleAssignId, session.user.id, tenant.id, now)
    }

    await audit({
      action: "tenant.create",
      category: "admin",
      userId: session?.user?.id,
      userEmail: session?.user?.email,
      resourceType: "tenant",
      resourceId: tenant.id,
      resourceName: tenant.name,
      status: "success",
    })

    return NextResponse.json({ data: tenant }, { status: 201 })
  } catch (e: any) {
    if (e.message?.includes("UNIQUE constraint")) {
      return NextResponse.json({ error: "A tenant with this slug already exists" }, { status: 409 })
    }
    return NextResponse.json({ error: e.message }, { status: 500 })
  }
}
