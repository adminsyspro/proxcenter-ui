import { NextResponse } from "next/server"

import { checkPermission, buildNodeResourceId, PERMISSIONS } from "@/lib/rbac"
import { orchestratorHeaders } from "@/lib/orchestrator/headers"
import { drainNodes, publicDrain } from "@/lib/hostDrain/access"
import { getCurrentTenantId } from "@/lib/tenant"
import { canMigrateConnections, getTenantInfrastructureScope } from "@/lib/tenant/infraScope"
import { withAudit } from "@/lib/audit/withAudit"

export const runtime = "nodejs"

const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || "http://localhost:8080"

// POST /api/v1/orchestrator/host-drains/[id]/cancel
// Nothing new is started; the migrations Proxmox already runs finish on their own.
async function handlePost(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await ctx.params
    const headers = await orchestratorHeaders({ "Content-Type": "application/json" })

    // The permission is checked on the drained node, like starting the drain;
    // for a selection of guests (#1218), on every node it moves guests from.
    const current = await fetch(`${ORCHESTRATOR_URL}/api/v1/host-drains/${encodeURIComponent(id)}`, { headers })
    const drain = await current.json()
    const nodes = drainNodes(drain ?? {})
    if (!current.ok || !drain?.connection_id || nodes.length === 0) {
      return NextResponse.json({ error: "Host drain not found" }, { status: 404 })
    }
    for (const node of nodes) {
      const denied = await checkPermission(PERMISSIONS.NODE_MANAGE, "node", buildNodeResourceId(drain.connection_id, node))
      if (denied) return denied
    }
    // A drain acts on every guest of the node: only a tenant that owns the
    // cluster may touch it (provider, or an MSP on its own cluster).
    const infra = await getTenantInfrastructureScope(await getCurrentTenantId())
    if (!canMigrateConnections(infra, drain.connection_id)) {
      return NextResponse.json({ error: "Host drain not found" }, { status: 404 })
    }

    const response = await fetch(`${ORCHESTRATOR_URL}/api/v1/host-drains/${encodeURIComponent(id)}/cancel`, { method: "POST", headers })
    const data = await response.json()
    if (!response.ok) {
      return NextResponse.json({ error: data.error || "Failed to cancel the host drain" }, { status: response.status })
    }

    return NextResponse.json({ data: publicDrain(data) })
  } catch (error: any) {
    if (error?.code !== "ORCHESTRATOR_UNAVAILABLE") console.error("Error cancelling host drain:", error)
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 })
  }
}

export const POST = withAudit({ category: "automation", resourceType: "host_drain", resourceParam: "id", action: "cancel" }, handlePost)
