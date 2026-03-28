export const dynamic = "force-dynamic"
import { NextResponse } from "next/server"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth/config"
import { getUserTenants } from "@/lib/tenant"

// GET /api/v1/auth/me/tenants — get current user's accessible tenants
export async function GET() {
  const session = await getServerSession(authOptions)
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  const tenants = getUserTenants(session.user.id)
  return NextResponse.json({
    data: tenants,
    currentTenantId: session.user.tenantId || 'default',
  })
}
