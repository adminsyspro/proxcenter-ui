import { NextResponse } from "next/server"

import { getSessionPrisma } from "@/lib/tenant"
import { checkPermission, getCurrentRbacInfraScope, isConnectionVisible, PERMISSIONS } from "@/lib/rbac"
import { isNodeInScope } from "@/lib/rbac/nodeList"

export const runtime = "nodejs"

/**
 * GET /api/v1/tags/entities — list all clusters and nodes that have tags
 */
export async function GET() {
  try {
    const denied = await checkPermission(PERMISSIONS.CONNECTION_VIEW)
    if (denied) return denied

    const prisma = await getSessionPrisma()

    const [connections, hosts] = await Promise.all([
      prisma.connection.findMany({
        where: { AND: [{ tags: { not: null } }, { tags: { not: '' } }] },
        select: { id: true, name: true, tags: true },
      }),
      prisma.managedHost.findMany({
        where: { AND: [{ tags: { not: null } }, { tags: { not: '' } }] },
        select: { id: true, connectionId: true, node: true, tags: true },
      }),
    ])

    // connection.view passes on a grant scoped to any connection: only the
    // clusters and nodes the caller's grants name.
    const scope = await getCurrentRbacInfraScope(PERMISSIONS.CONNECTION_VIEW)
    const data = [
      ...connections.filter(c => !scope || isConnectionVisible(scope, c.id)).map(c => ({ entityType: 'cluster', id: c.id, name: c.name, tags: c.tags })),
      ...hosts.filter(h => (h.connectionId ? isNodeInScope(scope, h.connectionId, h.node) : !scope)).map(h => ({ entityType: 'node', id: h.id, connectionId: h.connectionId, node: h.node, tags: h.tags })),
    ]

    return NextResponse.json({ data })
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || String(e) }, { status: 500 })
  }
}
