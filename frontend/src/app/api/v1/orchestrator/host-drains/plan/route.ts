import { NextResponse } from "next/server"

import { getCurrentTenantId, getSessionPrisma } from "@/lib/tenant"
import { PERMISSIONS } from "@/lib/rbac"
import { canMigrateConnections, getTenantInfrastructureScope } from "@/lib/tenant/infraScope"
import { orchestratorHeaders } from "@/lib/orchestrator/headers"
import { DrainConfigError, sanitizeDrainConfig } from "@/lib/hostDrain/config"
import { drainCluster, DrainTargetDenied, restrictDrainTargets } from "@/lib/hostDrain/access"
import { checkScopePermission, parseDrainScope, scopeError, scopeNode, scopeNodes } from "@/lib/hostDrain/scope"
import { isConnectionNotFoundError } from "@/lib/connections/getConnection"

export const runtime = "nodejs"

const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || "http://localhost:8080"

// POST /api/v1/orchestrator/host-drains/plan  { connection_id, node, config }
// Dry run: the guests of the node, where each one would go and which ones the
// drain would refuse. Nothing moves. A selection of guests (#1218) sends
// config.vmids and no node: the right to migrate each guest is then checked
// by restrictDrainTargets, as for the drain itself. A group of nodes
// (roadmap#198) sends config.nodes and no node: the right to view each one.
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => null)
    const connectionId = body?.connection_id
    const parsed = parseDrainScope(body)
    if (!connectionId) return scopeError("connection_id and node are required")
    if ("error" in parsed) return scopeError(parsed.error)
    const { scope } = parsed
    const safeNode = scopeNode(scope)

    const denied = await checkScopePermission(connectionId, scope, PERMISSIONS.NODE_VIEW)
    if (denied) return denied
    // The plan names every guest of the node: clusters the caller owns only.
    if (!canMigrateConnections(await getTenantInfrastructureScope(await getCurrentTenantId()), connectionId)) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 })
    }

    const prisma = await getSessionPrisma()
    const connection = await prisma.connection.findUnique({ where: { id: connectionId }, select: { id: true } })
    if (!connection) return NextResponse.json({ error: "Connection not found" }, { status: 404 })

    let config
    try {
      const requested = sanitizeDrainConfig(body.config)
      config = await restrictDrainTargets(await drainCluster(connectionId), connectionId, scopeNodes(scope), requested)
    } catch (e) {
      if (e instanceof DrainConfigError) return NextResponse.json({ error: e.message }, { status: 400 })
      if (isConnectionNotFoundError(e)) return NextResponse.json({ error: "Connection not found" }, { status: 404 })
      if (e instanceof DrainTargetDenied) return NextResponse.json({ error: e.message }, { status: 403 })
      throw e
    }

    const response = await fetch(`${ORCHESTRATOR_URL}/api/v1/host-drains/plan`, {
      method: "POST",
      headers: await orchestratorHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ connection_id: connectionId, node: safeNode, config }),
    })
    const data = await response.json()
    if (!response.ok) {
      return NextResponse.json({ error: data.error || "Failed to plan the host drain" }, { status: response.status })
    }

    return NextResponse.json({ data })
  } catch (error: any) {
    if (error?.code !== "ORCHESTRATOR_UNAVAILABLE") console.error("Error planning host drain:", error)
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 })
  }
}
