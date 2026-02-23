// src/app/api/v1/templates/deployments/route.ts
import { NextResponse } from "next/server"

import { prisma } from "@/lib/db/prisma"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

export async function GET(req: Request) {
  try {
    const denied = await checkPermission(PERMISSIONS.VM_VIEW)
    if (denied) return denied

    const { searchParams } = new URL(req.url)
    const limit = Math.min(parseInt(searchParams.get("limit") || "50"), 200)
    const status = searchParams.get("status")

    const where: any = {}
    if (status) where.status = status

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
