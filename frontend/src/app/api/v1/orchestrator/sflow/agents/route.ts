import { NextRequest, NextResponse } from "next/server"
import { SFLOW_MIN_SAMPLING } from "@/lib/ssh/sudo"

import { getCurrentTenantId, getSessionPrisma, requireProviderTenant } from "@/lib/tenant"
import { managedHostSshEndpoint } from "@/lib/ssh/node-endpoint-core"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { audit } from "@/lib/audit"
import { applySFlowOnNode, type SFlowDesiredConfig } from "@/lib/sflow/configure"
import { collectGuestMACs, mayClaimAgent, probeHost, type NodeSFlowStatus } from "@/lib/sflow/probe"
import { saveDesiredSFlowConfig } from "@/lib/sflow/reconciler"
import { reportExpectedAgents, type ExpectedAgentReport } from "@/lib/sflow/expectedAgents"
import { withAudit } from "@/lib/audit/withAudit"

// sFlow collector target: an "ip:port" / "host:port" string. Constrain it to
// hostname / IPv4 / IPv6 characters plus the port colon so it can be safely
// interpolated into the ovs-vsctl shell command below.
const COLLECTOR_TARGET_RE = /^[A-Za-z0-9._:[\]-]{1,255}$/

export const runtime = "nodejs"


// Tell the orchestrator which nodes it should hear from (roadmap#52). Only the
// nodes the probe reached: an unreachable node is unknown, not unconfigured,
// so it is left as the orchestrator knows it, and its cluster is not reported
// as complete (which would drop it).
function expectedAgentsFrom(statuses: NodeSFlowStatus[], connectionIds: string[]) {
  const unreachable = new Set(statuses.filter(n => !n.online).map(n => n.connectionId))

  return {
    connection_ids: connectionIds.filter(id => !unreachable.has(id)),
    agents: statuses.filter(n => n.online).map(n => toExpectedAgent(n)),
  }
}

function toExpectedAgent(n: NodeSFlowStatus, reconfigured = false): ExpectedAgentReport {
  return {
    connection_id: n.connectionId,
    connection_name: n.connectionName,
    node: n.node,
    agent_ip: n.ip,
    target: n.sflowTarget,
    polling_interval: n.sflowPolling,
    sampling_rate: n.sflowSampling,
    configured: n.hasOvs && n.sflowConfigured,
    reconfigured,
  }
}

// In-memory TTL cache per tenant. Each GET probes every node of every PVE connection
// over SSH (4 commands per node) plus pushes a port map to the Go orchestrator, so
// caching eliminates the SSH storm when users navigate back to the Network Flows page.
const CACHE_TTL_MS = 30_000
const agentsCache = new Map<string, { at: number; data: NodeSFlowStatus[] }>()

function invalidateAgentsCache(tenantId: string) {
  agentsCache.delete(tenantId)
}

// Record the outcome of a configure run. Without this there is no trace at all
// distinguishing "the user never pressed the button" from "it failed on every
// node", which is exactly the ambiguity that made this action look inert.
async function recordSFlowConfigureAudit(
  results: Array<{ node: string; success: boolean; error?: string; bridgesConfigured?: number }>,
  collectorTarget: string,
): Promise<void> {
  const failures = results.filter(r => !r.success)

  try {
    await audit({
      action: "update",
      category: "nodes",
      resourceType: "sflow",
      resourceName: `sFlow -> ${collectorTarget}`,
      status: failures.length === 0 ? "success" : "failure",
      errorMessage: failures.length > 0 ? failures.map(f => `${f.node}: ${f.error}`).join("; ") : undefined,
      details: {
        collectorTarget,
        nodes: results.length,
        configured: results.length - failures.length,
        perNode: results.map(r => ({
          node: r.node,
          success: r.success,
          bridges: r.bridgesConfigured ?? 0,
          error: r.error,
        })),
      },
    })
  } catch {
    // An audit failure must not mask the configuration result the caller is
    // about to report.
  }
}

// The connections among `ids` on which the caller holds `permission`. The
// checks at the top of each handler only say the caller holds it SOMEWHERE: a
// grant scoped to one connection passes them, so every connection read or
// configured is checked on its own.
async function connectionsGranted(permission: string, ids: Iterable<string>): Promise<Set<string>> {
  const granted = new Set<string>()
  for (const id of new Set(ids)) {
    if (!(await checkPermission(permission, "connection", id))) granted.add(id)
  }
  return granted
}

async function visibleAgents(data: NodeSFlowStatus[]): Promise<NodeSFlowStatus[]> {
  const viewable = await connectionsGranted(PERMISSIONS.CONNECTION_VIEW, data.map(n => n.connectionId))
  return data.filter(n => viewable.has(n.connectionId))
}

// GET /api/v1/orchestrator/sflow/agents — check sFlow status on all nodes
export async function GET() {
  try {
    const denied = await checkPermission(PERMISSIONS.CONNECTION_VIEW)
    if (denied) return denied

    const tenantId = await getCurrentTenantId()
    const cached = agentsCache.get(tenantId)
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      return NextResponse.json({ data: await visibleAgents(cached.data) })
    }

    const prisma = await getSessionPrisma()
    const connections = await prisma.connection.findMany({
      where: { type: "pve", sshEnabled: true },
      include: { hosts: true },
    })

    // Clusters probed in full, the ones the orchestrator may trust as complete.
    const probedConnectionIds: string[] = []
    const nested = await Promise.all(
      connections.map(async (conn): Promise<NodeSFlowStatus[]> => {
        if (!conn.sshKeyEnc && !conn.sshPassEnc) return []
        const targets = conn.hosts
          .filter(h => h.enabled && !!(h.ip || h.sshAddress))
          .map(h => {
            const endpoint = managedHostSshEndpoint(h, conn.sshPort)
            return { node: h.node, ip: h.ip || endpoint.host, endpoint }
          })
        if (targets.length === 0) return []
        probedConnectionIds.push(conn.id)

        // Cluster-wide, so the first node that answers covers every guest.
        const guestMacs = await collectGuestMACs(conn.id, targets.map(h => h.endpoint))

        return Promise.all(targets.map(t => probeHost(conn.id, conn.name, t.node, t.ip, t.endpoint, guestMacs, mayClaimAgent(conn.tenantId, t.ip, t.endpoint))))
      })
    )
    const results: NodeSFlowStatus[] = nested.flat()

    // The orchestrator keys the telemetry health on this inventory (roadmap#52).
    // It is fleet-wide state that drives alerts, so only the provider writes it.
    if (!(await requireProviderTenant())) {
      await reportExpectedAgents(expectedAgentsFrom(results, probedConnectionIds))
    }

    // The probe and its cache cover the tenant; each caller reads its own connections.
    agentsCache.set(tenantId, { at: Date.now(), data: results })
    return NextResponse.json({ data: await visibleAgents(results) })
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to check sFlow agents" },
      { status: 500 }
    )
  }
}

// POST /api/v1/orchestrator/sflow/agents — configure sFlow on selected nodes
async function handlePost(request: NextRequest) {
  try {
    const denied = await checkPermission(PERMISSIONS.CONNECTION_MANAGE)
    if (denied) return denied

    const body = await request.json()
    const { nodes, collectorTarget, samplingRate = 512, pollingInterval = 30 } = body

    if (!nodes || !Array.isArray(nodes) || nodes.length === 0) {
      return NextResponse.json({ error: "No nodes specified" }, { status: 400 })
    }
    if (!collectorTarget) {
      return NextResponse.json({ error: "Collector target is required (ip:port)" }, { status: 400 })
    }

    // These three values are interpolated into the ovs-vsctl shell command run
    // on every node, so constrain them before use (command injection):
    // collectorTarget to a host:port charset, and the two rates to integers.
    if (typeof collectorTarget !== "string" || !COLLECTOR_TARGET_RE.test(collectorTarget)) {
      return NextResponse.json({ error: "Invalid collector target (expected ip:port)" }, { status: 400 })
    }
    const safeSampling = Number(samplingRate)
    const safePolling = Number(pollingInterval)
    // Below 1 in 64 a busy node spends its CPU sampling, and the restricted
    // sudoers rule refuses it.
    if (!Number.isInteger(safeSampling) || safeSampling < SFLOW_MIN_SAMPLING || safeSampling > 1_000_000_000) {
      return NextResponse.json({ error: `samplingRate must be an integer between ${SFLOW_MIN_SAMPLING} and 1000000000` }, { status: 400 })
    }
    if (!Number.isInteger(safePolling) || safePolling < 1 || safePolling > 86_400) {
      return NextResponse.json({ error: "pollingInterval must be an integer between 1 and 86400" }, { status: 400 })
    }

    const desiredConfig: SFlowDesiredConfig = {
      collectorTarget,
      samplingRate: safeSampling,
      pollingInterval: safePolling,
    }

    const prisma = await getSessionPrisma()
    const connections = await prisma.connection.findMany({
      where: { type: "pve", sshEnabled: true },
      include: { hosts: true },
    })

    const results: Array<{
      node: string
      ip: string
      success: boolean
      error?: string
      bridgesConfigured?: number
    }> = []
    const manageable = await connectionsGranted(PERMISSIONS.CONNECTION_MANAGE, connections.map(c => c.id))
    // The nodes just set, for the orchestrator to start expecting them now:
    // the grace period before "telemetry missing" runs from this run.
    const configuredNow: ExpectedAgentReport[] = []

    for (const nodeReq of nodes) {
      const { ip, connectionId } = nodeReq
      const conn = connections.find(c => c.id === connectionId && manageable.has(c.id))
      if (!conn) {
        results.push({ node: nodeReq.node, ip, success: false, error: "Connection not found" })
        continue
      }
      // Only a node the connection lists, reached on its own address: the posted
      // ip is never a target, or the connection's credentials would be offered
      // to any host the caller names.
      const host = conn.hosts?.find(h => h.node === nodeReq.node && h.enabled && !!(h.ip || h.sshAddress))
      if (!host) {
        results.push({ node: nodeReq.node, ip, success: false, error: "Unknown node for this connection" })
        continue
      }

      try {
        const target = managedHostSshEndpoint(host, conn.sshPort)
        // The agent is pinned to the address the table and the port map key the
        // node on, the same `ip` the GET reports for it.
        const agentIp = host.ip || target.host
        const applied = await applySFlowOnNode(conn.id, target, desiredConfig, agentIp)

        results.push({
          node: nodeReq.node,
          ip,
          success: applied.success,
          error: applied.error,
          bridgesConfigured: applied.bridgesConfigured,
        })
        if (applied.success) {
          configuredNow.push({
            connection_id: conn.id,
            connection_name: conn.name,
            node: nodeReq.node,
            agent_ip: agentIp,
            target: collectorTarget,
            polling_interval: safePolling,
            sampling_rate: safeSampling,
            configured: true,
            reconfigured: true,
          })
        }
      } catch (e: any) {
        results.push({ node: nodeReq.node, ip, success: false, error: e.message })
      }
    }

    const successCount = results.filter(r => r.success).length

    // Invalidate the agents cache so the next GET reflects the new sFlow config
    const tenantId = await getCurrentTenantId()
    invalidateAgentsCache(tenantId)

    // Remember what was asked for, so the reconciler can put it back after a
    // node loses its OVS database. Only worth storing if it worked somewhere.
    // The reconciler puts it back on EVERY connection of the tenant, so only a
    // caller who manages all of them may set it.
    if (successCount > 0) {
      if (connections.every(c => manageable.has(c.id))) {
        await saveDesiredSFlowConfig(tenantId, desiredConfig)
      }
      if (!(await requireProviderTenant())) {
        await reportExpectedAgents({ connection_ids: [], agents: configuredNow })
      }
    }

    await recordSFlowConfigureAudit(results, collectorTarget)

    // A run where every node failed is an error, not a 200 carrying a flag no
    // caller reads. That silence is what made this action look like a no-op.
    const status = successCount === 0 ? 502 : 200

    return NextResponse.json(
      {
        success: successCount > 0,
        configured: successCount,
        total: results.length,
        results,
        error:
          successCount === 0
            ? results[0]?.error || "sFlow could not be configured on any node"
            : undefined,
      },
      { status }
    )
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to configure sFlow" },
      { status: 500 }
    )
  }
}

export const POST = withAudit({ category: "nodes", resourceType: "agent" }, handlePost)
