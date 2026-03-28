import { NextRequest, NextResponse } from "next/server"

import { getSessionPrisma } from "@/lib/tenant"
import { decryptSecret } from "@/lib/crypto/secret"
import { executeSSHDirect } from "@/lib/ssh/exec"
import { checkPermission, PERMISSIONS } from "@/lib/rbac"

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

// GET /api/v1/orchestrator/sflow/agents — check sFlow status on all nodes
export async function GET() {
  try {
    const denied = await checkPermission(PERMISSIONS.CONNECTION_VIEW)
    if (denied) return denied

    const prisma = await getSessionPrisma()
    const connections = await prisma.connection.findMany({
      where: { type: "pve", sshEnabled: true },
      include: { hosts: true },
    })

    const results: NodeSFlowStatus[] = []

    for (const conn of connections) {
      if (!conn.sshKeyEnc && !conn.sshPassEnc) continue

      const sshKey = conn.sshKeyEnc ? decryptSecret(conn.sshKeyEnc) : undefined
      const sshPass = conn.sshPassEnc ? decryptSecret(conn.sshPassEnc) : undefined

      for (const host of conn.hosts) {
        if (!host.enabled || !host.ip) continue

        const sshOpts = {
          host: host.ip,
          port: conn.sshPort || 22,
          user: conn.sshUser || "root",
          ...(conn.sshAuthMethod === "key" && sshKey ? { key: sshKey } : {}),
          ...(conn.sshAuthMethod === "password" && sshPass ? { password: sshPass } : {}),
          ...(conn.sshAuthMethod === "key" && sshPass ? { passphrase: sshPass } : {}),
        }

        const nodeStatus: NodeSFlowStatus = {
          node: host.node,
          ip: host.ip,
          connectionId: conn.id,
          connectionName: conn.name,
          online: true,
          hasOvs: false,
          ovsVersion: "",
          sflowConfigured: false,
          sflowTarget: "",
          sflowSampling: 0,
          bridges: [],
        }

        try {
          // Check if OVS is installed — try list-br first, fallback to which
          const bridgesResult = await executeSSHDirect({
            ...sshOpts,
            command: "ovs-vsctl list-br 2>/dev/null || true",
          })

          // Also try `which ovs-vsctl` as fallback if list-br returned empty
          let hasBridges = bridgesResult.success && !!bridgesResult.output?.trim()

          if (!hasBridges) {
            const whichResult = await executeSSHDirect({
              ...sshOpts,
              command: "which ovs-vsctl 2>/dev/null && ovs-vsctl list-br",
            })
            if (whichResult.success && whichResult.output?.trim()) {
              // Parse: first line is path, rest are bridges
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

            // Get OVS version
            const versionResult = await executeSSHDirect({
              ...sshOpts,
              command: "ovs-vsctl --version 2>/dev/null | head -1 || true",
            })
            if (versionResult.success && versionResult.output?.trim()) {
              const match = versionResult.output.match(/(\d+\.\d+\.\d+)/)
              if (match) nodeStatus.ovsVersion = match[1]
            }

            // Check if sFlow is configured on the first bridge
            const sflowResult = await executeSSHDirect({
              ...sshOpts,
              command: "ovs-vsctl list sflow 2>/dev/null | grep -E 'targets|agent|sampling' || true",
            })

            if (sflowResult.success && sflowResult.output?.includes("targets")) {
              nodeStatus.sflowConfigured = true
              const targetMatch = sflowResult.output.match(/targets\s*:\s*\["?([^"\]]+)/)
              if (targetMatch) {
                nodeStatus.sflowTarget = targetMatch[1]
              }
              const samplingMatch = sflowResult.output.match(/sampling\s*:\s*(\d+)/)
              if (samplingMatch) {
                nodeStatus.sflowSampling = Number.parseInt(samplingMatch[1], 10)
              }
            }
          }
        } catch {
          nodeStatus.online = false
        }

        results.push(nodeStatus)
      }
    }

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

      const sshKey = conn.sshKeyEnc ? decryptSecret(conn.sshKeyEnc) : undefined
      const sshPass = conn.sshPassEnc ? decryptSecret(conn.sshPassEnc) : undefined

      const sshOpts = {
        host: ip,
        port: conn.sshPort || 22,
        user: conn.sshUser || "root",
        ...(conn.sshAuthMethod === "key" && sshKey ? { key: sshKey } : {}),
        ...(conn.sshAuthMethod === "password" && sshPass ? { password: sshPass } : {}),
        ...(conn.sshAuthMethod === "key" && sshPass ? { passphrase: sshPass } : {}),
      }

      try {
        // Configure sFlow on all OVS bridges
        const cmd = `for br in $(ovs-vsctl list-br); do ovs-vsctl -- clear Bridge $br sflow; ovs-vsctl -- set Bridge $br sflow=@s -- --id=@s create sflow agent=$br target=\\"${collectorTarget}\\" header=128 sampling=${samplingRate} polling=${pollingInterval}; done`

        const result = await executeSSHDirect({
          ...sshOpts,
          command: cmd,
        })

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
