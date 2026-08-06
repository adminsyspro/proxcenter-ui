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

    // vDCs may only slice provider-pool connections (IaaS/MSP exclusivity).
    // Load the pool membership once and flag each connection so consumers
    // (e.g. the vDC cluster picker) can filter MSP-owned connections out.
    const pool = new Set(
      (await prisma.providerConnection.findMany({ select: { connectionId: true } })).map(p => p.connectionId)
    )

    return NextResponse.json({
      data: connections.map(c => ({ ...c, inProviderPool: pool.has(c.id) })),
    })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
