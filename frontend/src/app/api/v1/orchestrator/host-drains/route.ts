import { NextResponse } from "next/server"

import { getCurrentTenantId, getSessionPrisma } from "@/lib/tenant"
import { canMigrateConnections, getTenantInfrastructureScope } from "@/lib/tenant/infraScope"
import { checkPermission, buildNodeResourceId, PERMISSIONS } from "@/lib/rbac"
import { orchestratorHeaders } from "@/lib/orchestrator/headers"
import { DrainConfigError, sanitizeDrainConfig } from "@/lib/hostDrain/config"
import { drainCluster, DrainTargetDenied, filterViewableDrains, publicDrain, restrictDrainTargets } from "@/lib/hostDrain/access"
import { loadOrchestratorSshAccess } from "@/lib/orchestrator/sshCredentials"
import { assertNodeName } from "@/lib/ssh/validate"
import { isConnectionNotFoundError } from "@/lib/connections/getConnection"
import { withAudit } from "@/lib/audit/withAudit"

export const runtime = "nodejs"

const ORCHESTRATOR_URL = process.env.ORCHESTRATOR_URL || "http://localhost:8080"

/**
 * Host drains (#248): the orchestrator evacuates a node guest by guest with
 * the placement engine of the rolling updates, instead of the browser sending
 * every guest to one node in batches of five.
 */

// GET /api/v1/orchestrator/host-drains?connection_id=  (tenant-filtered)
export async function GET(req: Request) {
  try {
    const denied = await checkPermission(PERMISSIONS.TASKS_VIEW)
    if (denied) return denied

    const { searchParams } = new URL(req.url)
    const connectionId = searchParams.get("connection_id")

    // A drain lists every guest of the node, other tenants' included: only
    // the clusters the caller owns (provider, or an MSP on its own) count,
    // never the clusters a vDC merely shares.
    const infra = await getTenantInfrastructureScope(await getCurrentTenantId())
    const owns = (id: string) => canMigrateConnections(infra, id)

    if (connectionId && !owns(connectionId)) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 })
    }

    let url = `${ORCHESTRATOR_URL}/api/v1/host-drains`
    if (connectionId) url += `?connection_id=${encodeURIComponent(connectionId)}`

    const response = await fetch(url, { headers: await orchestratorHeaders({ "Content-Type": "application/json" }) })
    const data = await response.json()
    if (!response.ok) {
      return NextResponse.json({ error: data.error || "Failed to list host drains" }, { status: response.status })
    }

    const items: any[] = Array.isArray(data) ? data : (data?.data || [])
    // Deny by default: a row with no connection_id is provider-only.
    const owned = items.filter(d => d.connection_id ? owns(d.connection_id) : infra.kind === "provider")
    // Same gate as one drain: the right to view the drained node.
    const filtered = await filterViewableDrains(owned)

    return NextResponse.json({ data: filtered.map(publicDrain) })
  } catch (error: any) {
    if (error?.code !== "ORCHESTRATOR_UNAVAILABLE") console.error("Error listing host drains:", error)
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 })
  }
}

// POST /api/v1/orchestrator/host-drains  { connection_id, node, config }
async function handlePost(req: Request) {
  try {
    const body = await req.json().catch(() => null)
    const connectionId = body?.connection_id
    const node = body?.node

    if (!connectionId || !node) {
      return NextResponse.json({ error: "connection_id and node are required" }, { status: 400 })
    }

    let safeNode: string
    try {
      safeNode = assertNodeName(node)
    } catch {
      return NextResponse.json({ error: "Invalid node name" }, { status: 400 })
    }

    // Same permission as entering maintenance or migrating from the node, on
    // a cluster the caller owns.
    const denied = await checkPermission(PERMISSIONS.NODE_MANAGE, "node", buildNodeResourceId(connectionId, safeNode))
    if (denied) return denied
    if (!canMigrateConnections(await getTenantInfrastructureScope(await getCurrentTenantId()), connectionId)) {
      return NextResponse.json({ error: "Connection not found" }, { status: 404 })
    }

    const prisma = await getSessionPrisma()
    let config: Record<string, unknown>
    try {
      const requested = sanitizeDrainConfig(body.config)
      config = { ...(await restrictDrainTargets(await drainCluster(connectionId), connectionId, safeNode, requested)) }
    } catch (e) {
      if (e instanceof DrainConfigError) return NextResponse.json({ error: e.message }, { status: 400 })
      if (isConnectionNotFoundError(e)) return NextResponse.json({ error: "Connection not found" }, { status: 404 })
      if (e instanceof DrainTargetDenied) return NextResponse.json({ error: e.message }, { status: 403 })
      throw e
    }

    // ha-manager runs over SSH: only the maintenance path needs the credentials.
    if (config.enter_maintenance) {
      let access
      try {
        access = await loadOrchestratorSshAccess(prisma, connectionId)
      } catch (e: any) {
        console.error("Failed to decrypt SSH credentials:", e?.message)
        return NextResponse.json({ error: "Failed to decrypt SSH credentials" }, { status: 500 })
      }
      if (!access) {
        return NextResponse.json({ error: "Connection not found" }, { status: 404 })
      }
      if (!access.sshEnabled || !access.credentials) {
        return NextResponse.json(
          { error: "SSH is not enabled for this connection. Entering maintenance requires SSH access." },
          { status: 400 },
        )
      }
      config.ssh_credentials = access.credentials
      if (Object.keys(access.overrides).length > 0) config.ssh_overrides = access.overrides
    } else {
      const connection = await prisma.connection.findUnique({ where: { id: connectionId }, select: { id: true } })
      if (!connection) return NextResponse.json({ error: "Connection not found" }, { status: 404 })
    }

    const response = await fetch(`${ORCHESTRATOR_URL}/api/v1/host-drains`, {
      method: "POST",
      headers: await orchestratorHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ connection_id: connectionId, node: safeNode, config }),
    })
    const data = await response.json()
    if (!response.ok) {
      return NextResponse.json({ error: data.error || "Failed to start the host drain" }, { status: response.status })
    }

    return NextResponse.json({ data: publicDrain(data) })
  } catch (error: any) {
    if (error?.code !== "ORCHESTRATOR_UNAVAILABLE") console.error("Error starting host drain:", error)
    return NextResponse.json({ error: error.message || "Internal server error" }, { status: 500 })
  }
}

export const POST = withAudit({ category: "automation", resourceType: "host_drain" }, handlePost)
