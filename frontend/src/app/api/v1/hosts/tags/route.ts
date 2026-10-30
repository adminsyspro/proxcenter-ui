import { NextResponse } from "next/server"

import { getSessionPrisma } from "@/lib/tenant"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { withAudit } from "@/lib/audit/withAudit"

export const runtime = "nodejs"

/**
 * PATCH /api/v1/hosts/tags — update tags for a host by connectionId + node
 * Body: { connectionId, node, tags }
 */
async function handlePatch(req: Request) {
  try {
    const denied = await checkPermission(PERMISSIONS.ADMIN_SETTINGS)
    if (denied) return denied

    const prisma = await getSessionPrisma()
    const body = await req.json().catch(() => null)

    if (!body?.connectionId || !body?.node) {
      return NextResponse.json({ error: "Missing connectionId or node" }, { status: 400 })
    }

    // The row this may create is the SSH override of a node: only the owner
    // of the connection writes one (roadmap#99).
    const connection = await prisma.connection.findUnique({ where: { id: String(body.connectionId) }, select: { id: true } })
    if (!connection) return NextResponse.json({ error: "Connection not found" }, { status: 404 })

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

export const PATCH = withAudit({ category: "nodes", resourceType: "tag" }, handlePatch)
