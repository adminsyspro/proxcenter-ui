import { NextRequest, NextResponse } from "next/server"

import { getCurrentTenantId, getSessionPrisma } from "@/lib/tenant"
import { orchestratorFetch } from "@/lib/orchestrator"
import { executeSSH, shellEscape } from "@/lib/ssh/exec"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"

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

      // Refresh the Go orchestrator port map so sFlow samples can be decoded
      // with VM context (ifIndex → VMID). Non-critical — don't fail the probe.
      if (ipLinkResult.success && ipLinkResult.output) {
        await orchestratorFetch("/sflow/portmap", {
          method: "POST",
          body: { agent_ip: ip, ip_link_output: ipLinkResult.output },
        }).catch(() => {})
      }
    }
  } catch {
    nodeStatus.online = false
  }

  return nodeStatus
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
        return Promise.all(targets.map(host => probeHost(conn.id, conn.name, host.node, host.ip)))
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

    const prisma = await getSessionPrisma()
    const connections = await prisma.connection.findMany({
      where: { type: "pve", sshEnabled: true },
      include: { hosts: true },
    })

    const results: Array<{ node: string; ip: string; success: boolean; error?: string }> = []

    for (const nodeReq of nodes) {
      const { ip, connectionId } = nodeReq
      const conn = connections.find(c => c.id === connectionId)
      if (!conn) {
        results.push({ node: nodeReq.node, ip, success: false, error: "Connection not found" })
        continue
      }

      try {
        // Configure sFlow on all OVS bridges
        const cmd = `for br in $(ovs-vsctl list-br); do ovs-vsctl -- clear Bridge $br sflow; ovs-vsctl -- set Bridge $br sflow=@s -- --id=@s create sflow agent=$br target=${shellEscape(collectorTarget)} header=128 sampling=${safeSampling} polling=${safePolling}; done`

        const result = await executeSSH(conn.id, ip, cmd)

        results.push({
          node: nodeReq.node,
          ip,
          success: result.success,
          error: result.success ? undefined : result.error,
        })
      } catch (e: any) {
        results.push({ node: nodeReq.node, ip, success: false, error: e.message })
      }
    }

    const successCount = results.filter(r => r.success).length

    // Invalidate the agents cache so the next GET reflects the new sFlow config
    invalidateAgentsCache(await getCurrentTenantId())

    return NextResponse.json({
      success: successCount > 0,
      configured: successCount,
      total: results.length,
      results,
    })
  } catch (error: any) {
    return NextResponse.json(
      { error: error.message || "Failed to configure sFlow" },
      { status: 500 }
    )
  }
}
