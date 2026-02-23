// src/app/api/v1/templates/deployments/[id]/route.ts
import { NextResponse } from "next/server"

import { prisma } from "@/lib/db/prisma"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> | { id: string } }) {
  try {
    const params = await Promise.resolve(ctx.params)
    const id = (params as any)?.id
    if (!id) return NextResponse.json({ error: "Missing params.id" }, { status: 400 })

    const denied = await checkPermission(PERMISSIONS.VM_VIEW)
    if (denied) return denied

    const deployment = await prisma.deployment.findUnique({ where: { id } })
    if (!deployment) return NextResponse.json({ error: "Deployment not found" }, { status: 404 })

    return NextResponse.json({ data: deployment })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
