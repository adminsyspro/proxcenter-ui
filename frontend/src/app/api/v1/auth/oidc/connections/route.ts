// GET /api/v1/auth/oidc/connections — every customer tenant with the state of
// its own OIDC connection (issue #1289). Provider admins only.
import { NextResponse } from "next/server"

import { prisma } from "@/lib/db/prisma"
import { PERMISSIONS } from "@/lib/rbac"
import { requireProviderAdmin } from "@/lib/tenant/providerGuard"

export const runtime = "nodejs"

export async function GET() {
  try {
    const denied = await requireProviderAdmin(PERMISSIONS.ADMIN_SETTINGS)
    if (denied) return denied

    const tenants = await prisma.tenant.findMany({
      where: { id: { not: "default" } },
      select: {
        id: true,
        slug: true,
        name: true,
        enabled: true,
        oidcSelfService: true,
        oidcConnection: { select: { enabled: true, providerName: true, issuerUrl: true, clientId: true } },
      },
      orderBy: { name: "asc" },
    })

    return NextResponse.json({
      data: tenants.map(t => ({
        tenant_id: t.id,
        slug: t.slug,
        name: t.name,
        tenant_enabled: t.enabled,
        self_service: t.oidcSelfService,
        configured: !!t.oidcConnection,
        enabled: t.oidcConnection?.enabled ?? false,
        provider_name: t.oidcConnection?.providerName || "",
        issuer_url: t.oidcConnection?.issuerUrl || "",
      })),
    })
  } catch (error: any) {
    console.error("Error GET tenant OIDC connections:", error)
    return NextResponse.json({ error: "Server error" }, { status: 500 })
  }
}
