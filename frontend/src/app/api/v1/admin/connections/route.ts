// Admin endpoint: list ALL connections across all tenants (for vDC management)
import { NextResponse } from "next/server"

import { prisma } from "@/lib/db/prisma"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { requireProviderTenant } from "@/lib/tenant"

export const runtime = "nodejs"

export async function GET(req: Request) {
  try {
    const providerGate = await requireProviderTenant()

    if (providerGate) return providerGate
    const denied = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)

    if (denied) return denied

    const url = new URL(req.url)
    const typeFilter = url.searchParams.get('type')

    const where: any = {}

    if (typeFilter) where.type = typeFilter

    const connections = await prisma.connection.findMany({
      where: Object.keys(where).length > 0 ? where : undefined,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        tenantId: true,
        name: true,
        type: true,
        baseUrl: true,
        hasCeph: true,
        sshEnabled: true,
        fingerprint: true,
        createdAt: true,
      },
    })

    return NextResponse.json({ data: connections })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
