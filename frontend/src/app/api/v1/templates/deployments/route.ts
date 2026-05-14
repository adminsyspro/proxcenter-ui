// src/app/api/v1/templates/deployments/route.ts
import { NextResponse } from "next/server"

import { getSessionPrisma } from "@/lib/tenant"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

export async function GET(req: Request) {
  try {
    const prisma = await getSessionPrisma()
    const denied = await checkPermission(PERMISSIONS.VM_VIEW)

    if (denied) return denied

    const { searchParams } = new URL(req.url)
    const limit = Math.min(Number.parseInt(searchParams.get("limit") || "50"), 200)
    const status = searchParams.get("status")

    // Convenience flag for the navbar TasksDropdown: surface every
    // deployment that is still progressing (anything that's not a terminal
    // completed/failed state). Mutually exclusive with the explicit
    // `status=` filter below — `status=` wins when both are set.
    const activeOnly = searchParams.get("activeOnly") === "true"

    const where: any = {}

    if (status) {
      where.status = status
    } else if (activeOnly) {
      where.status = { in: ["pending", "downloading", "creating", "configuring", "starting"] }
    }

    const deployments = await prisma.deployment.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
    })

    return NextResponse.json({ data: deployments })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
