import { NextResponse } from "next/server"

import { withPublicApiGuard } from "@/lib/api-tokens/routeGuard"
import { loadPublicView } from "@/lib/api-tokens/publicRoutePrologue"
import { PERMISSIONS } from "@/lib/rbac"
import type { Principal } from "@/lib/auth/principal"

export const runtime = "nodejs"

// Authenticated companion of the unauthenticated /api/health liveness probe
// (frontend/src/proxy.ts), which stays the load-balancer probe. This
// one adds the per-connection detail, filtered by tenant and token
// perimeter.
async function handler(_req: Request, ctx: { principal?: Principal }) {
  const principal = ctx?.principal
  const result = await loadPublicView(principal, PERMISSIONS.NODE_VIEW)
  if (!result.ok) return result.response
  const view = result.view

  const connections = view.clusters.map(cluster => {
    const nodesTotal = cluster.nodes.length
    const nodesOnline = cluster.nodes.filter(node => node.status === "online").length
    return {
      connId: cluster.id,
      name: cluster.name,
      // Degraded as soon as ANY visible connection has no online node.
      reachable: nodesOnline > 0,
      nodesOnline,
      nodesTotal,
    }
  })

  return NextResponse.json({
    data: {
      status: connections.every(conn => conn.reachable) ? "ok" : "degraded",
      tenantId: view.tenantId,
      cached: view.cached,
      connections,
    },
  })
}

export const GET = withPublicApiGuard("public-health", handler)
