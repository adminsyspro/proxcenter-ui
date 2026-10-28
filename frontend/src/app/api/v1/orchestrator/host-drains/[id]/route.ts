import { NextResponse } from "next/server"

import { getCurrentTenantId } from "@/lib/tenant"
import { canMigrateConnections, getTenantInfrastructureScope } from "@/lib/tenant/infraScope"
import { buildNodeResourceId, checkPermission, PERMISSIONS } from "@/lib/rbac"
import { orchestratorHeaders } from "@/lib/orchestrator/headers"
import { drainNodes, publicDrain } from "@/lib/hostDrain/access"

export const runtime = "nodejs"

const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || "http://localhost:8080"

// GET /api/v1/orchestrator/host-drains/[id]
// A drain lists every guest of its node: only a tenant that owns the cluster
// sees it (provider, or an MSP on its own cluster), and only with the right
// to view that node.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const denied = await checkPermission(PERMISSIONS.TASKS_VIEW)
    if (denied) return denied

    const { id } = await ctx.params
    const response = await fetch(`${ORCHESTRATOR_URL}/api/v1/host-drains/${encodeURIComponent(id)}`, {
      headers: await orchestratorHeaders({ "Content-Type": "application/json" }),
    })
    const data = await response.json()
    if (!response.ok) {
      return NextResponse.json({ error: data.error || "Host drain not found" }, { status: response.status })
    }

    const infra = await getTenantInfrastructureScope(await getCurrentTenantId())
    // A selection of guests (#1218) has no node: every node it moves guests
    // from is checked instead.
    const nodes = drainNodes(data ?? {})
    if (!data?.connection_id || nodes.length === 0 || !canMigrateConnections(infra, data.connection_id)) {
      return NextResponse.json({ error: "Host drain not found" }, { status: 404 })
    }
    for (const node of nodes) {
      const nodeDenied = await checkPermission(PERMISSIONS.NODE_VIEW, "node", buildNodeResourceId(data.connection_id, node))
      if (nodeDenied) return nodeDenied
    }

    return NextResponse.json({ data: publicDrain(data) })
  } catch (error: any) {
    if (error?.code !== "ORCHESTRATOR_UNAVAILABLE") console.error("Error getting host drain:", error)
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 })
  }
}
