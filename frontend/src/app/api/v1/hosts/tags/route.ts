import { NextResponse } from "next/server"

import { getSessionPrisma } from "@/lib/tenant"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"

export const runtime = "nodejs"

/**
 * PATCH /api/v1/hosts/tags — update tags for a host by connectionId + node
 * Body: { connectionId, node, tags }
 */
export async function PATCH(req: Request) {
  try {
    const denied = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)

    if (denied) return denied

    const prisma = await getSessionPrisma()
    const body = await req.json().catch(() => null)

    if (!body?.connectionId || !body?.node) {
      return NextResponse.json({ error: "Missing connectionId or node" }, { status: 400 })
    }

    const tags = body.tags ? String(body.tags) : null

    const host = await prisma.managedHost.upsert({
      where: { connectionId_node: { connectionId: body.connectionId, node: body.node } },
      update: { tags },
      create: { connectionId: body.connectionId, node: body.node, tags },
    })

    return NextResponse.json({ data: { id: host.id, tags: host.tags } })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
