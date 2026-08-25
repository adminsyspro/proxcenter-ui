import { NextRequest, NextResponse } from "next/server"

import { getCurrentTenantId, getSessionPrisma } from "@/lib/tenant"
import { orchestratorFetch } from "@/lib/orchestrator"
import { executeSSH } from "@/lib/ssh/exec"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"
import { audit } from "@/lib/audit"
import { applySFlowOnNode, type SFlowDesiredConfig } from "@/lib/sflow/configure"
import { GUEST_MACS_COMMAND, parseGuestMACs } from "@/lib/sflow/guestMacs"
import { saveDesiredSFlowConfig } from "@/lib/sflow/reconciler"

// sFlow collector target: an "ip:port" / "host:port" string. Constrain it to
// hostname / IPv4 / IPv6 characters plus the port colon so it can be safely
// interpolated into the ovs-vsctl shell command below.
const COLLECTOR_TARGET_RE = /^[A-Za-z0-9._:[\]-]{1,255}$/

export const runtime = "nodejs"

interface NodeSFlowStatus {
  node: string
  ip: string
  connectionId: string
  connectionName: string
  online: boolean
  hasOvs: boolean
  ovsVersion: string
  sflowConfigured: boolean
  sflowTarget: string
  sflowSampling: number
  bridges: string[]
  // Why the port map push failed, when it did. Swallowing it made a node that
  // could never attribute a flow look identical to one waiting for traffic.
  portMapError: string
}

// Read every guest NIC MAC of a cluster, from any one of its nodes. The command
// and the parsing live in @/lib/sflow/guestMacs, which documents why the path is
// what it is.
//
// Tries the hosts in turn: one reachable node answers for the whole cluster, and
// depending on a single one would lose the whole table whenever that node is down.
async function collectGuestMACs(connId: string, ips: string[]): Promise<Record<string, number>> {
  for (const ip of ips) {
    const result = await executeSSH(connId, ip, GUEST_MACS_COMMAND)
    if (!result.success) continue

    const macs = parseGuestMACs(result.output ?? "")
    if (Object.keys(macs).length > 0) return macs
  }

  return {}
}

// In-memory TTL cache per tenant. Each GET probes every node of every PVE connection
// over SSH (4 commands per node) plus pushes a port map to the Go orchestrator, so
// caching eliminates the SSH storm when users navigate back to the Network Flows page.
const CACHE_TTL_MS = 30_000
const agentsCache = new Map<string, { at: number; data: NodeSFlowStatus[] }>()

function invalidateAgentsCache(tenantId: string) {
  agentsCache.delete(tenantId)
}

// Probe a single PVE node: detect OVS, capture version + sFlow config, and push
// the port map to the Go orchestrator. Returns a status entry even on failure
// so the UI can show the node as offline. Independent SSH commands run in
// parallel once OVS presence is confirmed.
async function probeHost(
  connId: string,
  connName: string,
  nodeName: string,
  ip: string,
  guestMacs: Record<string, number>,
): Promise<NodeSFlowStatus> {
  const nodeStatus: NodeSFlowStatus = {
    node: nodeName,
    ip,
    connectionId: connId,
    connectionName: connName,
    online: true,
    hasOvs: false,
    ovsVersion: "",
    sflowConfigured: false,
    sflowTarget: "",
    sflowSampling: 0,
    bridges: [],
    portMapError: "",
  }

  try {
    const bridgesResult = await executeSSH(connId, ip, "ovs-vsctl list-br 2>/dev/null || true")
    let hasBridges = bridgesResult.success && !!bridgesResult.output?.trim()

    if (!hasBridges) {
      // Fallback: ovs-vsctl may not be in PATH — probe with which
      const whichResult = await executeSSH(connId, ip, "which ovs-vsctl 2>/dev/null && ovs-vsctl list-br")
      if (whichResult.success && whichResult.output?.trim()) {
        const lines = whichResult.output.trim().split("\n").filter(Boolean)
        if (lines.length > 0 && lines[0].includes("ovs-vsctl")) {
          hasBridges = true
          nodeStatus.hasOvs = true
          nodeStatus.bridges = lines.slice(1)
        }
      }
    }

    if (hasBridges) {
      nodeStatus.hasOvs = true
      if (!nodeStatus.bridges.length && bridgesResult.output?.trim()) {
        nodeStatus.bridges = bridgesResult.output.trim().split("\n").filter(Boolean)
      }

      // Run the three remaining probes concurrently since they're independent
      const [versionResult, sflowResult, ipLinkResult] = await Promise.all([
        executeSSH(connId, ip, "ovs-vsctl --version 2>/dev/null | head -1 || true"),
        executeSSH(connId, ip, "ovs-vsctl list sflow 2>/dev/null | grep -E 'targets|agent|sampling' || true"),
        executeSSH(connId, ip, "ip -o link 2>/dev/null"),
      ])

      if (versionResult.success && versionResult.output?.trim()) {
        const match = versionResult.output.match(/(\d+\.\d+\.\d+)/)
        if (match) nodeStatus.ovsVersion = match[1]
      }

      if (sflowResult.success && sflowResult.output?.includes("targets")) {
        nodeStatus.sflowConfigured = true
        const targetMatch = sflowResult.output.match(/targets\s*:\s*\["?([^"\]]+)/)
        if (targetMatch) nodeStatus.sflowTarget = targetMatch[1]
        const samplingMatch = sflowResult.output.match(/sampling\s*:\s*(\d+)/)
        if (samplingMatch) nodeStatus.sflowSampling = Number.parseInt(samplingMatch[1], 10)
      }

      // Refresh the Go orchestrator port map so sFlow samples can be attributed
      // to a guest: by ifIndex when the guest port is on the sampled bridge, by
      // guest MAC otherwise. The failure is reported rather than swallowed,
      // because a silent failure here is indistinguishable from "no traffic".
      if ((ipLinkResult.success && ipLinkResult.output) || Object.keys(guestMacs).length > 0) {
        try {
          await orchestratorFetch("/sflow/portmap", {
            method: "POST",
            body: {
              agent_ip: ip,
              ip_link_output: ipLinkResult.output ?? "",
              guest_macs: guestMacs,
            },
          })
        } catch (e: any) {
          nodeStatus.portMapError = e?.message || "port map push failed"
        }
      }
    }
  } catch {
    nodeStatus.online = false
  }

  return nodeStatus
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

// GET /api/v1/orchestrator/sflow/agents — check sFlow status on all nodes
export async function GET() {
  try {
    const denied = await checkPermission(PERMISSIONS.CONNECTION_VIEW)
    if (denied) return denied

    const tenantId = await getCurrentTenantId()
    const cached = agentsCache.get(tenantId)
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
      return NextResponse.json({ data: cached.data })
    }

    const prisma = await getSessionPrisma()
    const connections = await prisma.connection.findMany({
      where: { type: "pve", sshEnabled: true },
      include: { hosts: true },
    })

    const nested = await Promise.all(
      connections.map(async (conn): Promise<NodeSFlowStatus[]> => {
        if (!conn.sshKeyEnc && !conn.sshPassEnc) return []
        const targets = conn.hosts.filter((h): h is typeof h & { ip: string } => h.enabled && !!h.ip)
        if (targets.length === 0) return []

        // Cluster-wide, so the first node that answers covers every guest.
        const guestMacs = await collectGuestMACs(conn.id, targets.map(h => h.ip))

        return Promise.all(targets.map(host => probeHost(conn.id, conn.name, host.node, host.ip, guestMacs)))
      })
    )
    const results: NodeSFlowStatus[] = nested.flat()

    agentsCache.set(tenantId, { at: Date.now(), data: results })
    return NextResponse.json({ data: results })
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to check sFlow agents" },
      { status: 500 }
    )
  }
}

// POST /api/v1/orchestrator/sflow/agents — configure sFlow on selected nodes
export async function POST(request: NextRequest) {
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
    if (!Number.isInteger(safeSampling) || safeSampling < 1 || safeSampling > 1_000_000_000) {
      return NextResponse.json({ error: "samplingRate must be an integer between 1 and 1000000000" }, { status: 400 })
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

    for (const nodeReq of nodes) {
      const { ip, connectionId } = nodeReq
      const conn = connections.find(c => c.id === connectionId)
      if (!conn) {
        results.push({ node: nodeReq.node, ip, success: false, error: "Connection not found" })
        continue
      }

      try {
        const applied = await applySFlowOnNode(conn.id, ip, desiredConfig)

        results.push({
          node: nodeReq.node,
          ip,
          success: applied.success,
          error: applied.error,
          bridgesConfigured: applied.bridgesConfigured,
        })
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
    if (successCount > 0) {
      await saveDesiredSFlowConfig(tenantId, desiredConfig)
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
