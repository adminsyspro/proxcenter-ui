// src/app/api/v1/templates/network-options/route.ts
import { NextResponse } from "next/server"

import { getSessionPrisma } from "@/lib/tenant"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { buildNetworkOptions } from "@/lib/templates/networkOptions"

export const runtime = "nodejs"

export async function GET(_req: Request) {
  try {
    const denied = await checkPermission(PERMISSIONS.VM_VIEW)
    if (denied) return denied

    // getSessionPrisma() returns a tenant-scoped client. Vdc has a `tenantId`
    // column so the scoping extension filters it automatically — no manual
    // `where.tenantId` needed here.
    const prisma = await getSessionPrisma()

    // NOTE: do NOT query prisma.vdcVnet directly — VdcVnet has no `tenantId`
    // column, which would cause the tenant-scoping extension to inject a
    // non-existent filter. Always go through vdc (which has tenantId).
    const vdcs = await prisma.vdc.findMany({
      where: { enabled: true },
      include: { vnets: { include: { subnet: true } } },
    }).catch(() => [])

    const options = buildNetworkOptions(vdcs as any)

    return NextResponse.json({ data: { options } })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
