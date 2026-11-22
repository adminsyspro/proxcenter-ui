// src/lib/sflow/probe.ts
//
// The SSH probe of a Proxmox node's sFlow agent (Open vSwitch, version, sFlow configuration) and the push of its port
// map to the orchestrator, shared by the agents route (Settings > sFlow) and the periodic sFlow pass
// (lib/sflow/reconciler.ts), so the volume history attributes samples to guests even when nobody opens the page.
// SSH only: no Proxmox API call.
import { orchestratorFetch } from "@/lib/orchestrator"
import { executeSSH } from "@/lib/ssh/exec"
import type { NodeSshEndpoint } from "@/lib/ssh/node-endpoint-core"
import { asRoot } from "@/lib/ssh/sudo"
import { GUEST_MACS_COMMAND, parseGuestMACs } from "@/lib/sflow/guestMacs"

export interface NodeSFlowStatus {
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
  // Counter polling interval in seconds, the cadence a healthy agent speaks
  // at even with every guest powered off (roadmap#52).
  sflowPolling: number
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
// Every probe of this route only reads, so a cluster outside the license is
// still listed with its sFlow state (roadmap#58); configuring it is refused.
const READ_ONLY = { readOnly: true }

export async function collectGuestMACs(connId: string, ips: NodeSshEndpoint[]): Promise<Record<string, number>> {
  for (const ip of ips) {
    const result = await executeSSH(connId, ip, GUEST_MACS_COMMAND, undefined, READ_ONLY)
    if (!result.success) continue

    const macs = parseGuestMACs(result.output ?? "")
    if (Object.keys(macs).length > 0) return macs
  }

  return {}
}

// Probe a single PVE node over its SSH endpoint (`ssh`): detect OVS, capture
// version + sFlow config, and push the port map to the Go orchestrator, keyed
// by `ip`, the node's own address (the sFlow agent address). Returns a status entry even on failure
// so the UI can show the node as offline. Independent SSH commands run in
// parallel once OVS presence is confirmed.
export async function probeHost(
  connId: string,
  connName: string,
  nodeName: string,
  ip: string,
  ssh: NodeSshEndpoint,
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
    sflowPolling: 0,
    bridges: [],
    portMapError: "",
  }

  try {
    const bridgesResult = await executeSSH(connId, ssh, `${asRoot("ovs-vsctl list-br")} 2>/dev/null || true`, undefined, READ_ONLY)
    let hasBridges = bridgesResult.success && !!bridgesResult.output?.trim()

    if (!hasBridges) {
      // Fallback: ovs-vsctl may not be in PATH, probe with which
      const whichResult = await executeSSH(connId, ssh, `which ovs-vsctl 2>/dev/null && ${asRoot("ovs-vsctl list-br")}`, undefined, READ_ONLY)
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
        executeSSH(connId, ssh, `${asRoot("ovs-vsctl --version")} 2>/dev/null | head -1 || true`, undefined, READ_ONLY),
        executeSSH(connId, ssh, `${asRoot("ovs-vsctl list sflow")} 2>/dev/null | grep -E 'targets|agent|sampling|polling' || true`, undefined, READ_ONLY),
        executeSSH(connId, ssh, "ip -o link 2>/dev/null", undefined, { ...READ_ONLY, asAccount: true }),
      ])

      if (versionResult.success && versionResult.output?.trim()) {
        const match = versionResult.output.match(/(?<!\d)(\d+\.\d+\.\d+)/)
        if (match) nodeStatus.ovsVersion = match[1]
      }

      if (sflowResult.success && sflowResult.output?.includes("targets")) {
        nodeStatus.sflowConfigured = true
        const targetMatch = sflowResult.output.match(/targets\s*:\s*\["?([^"\]]+)/)
        if (targetMatch) nodeStatus.sflowTarget = targetMatch[1]
        const samplingMatch = sflowResult.output.match(/sampling\s*:\s*(\d+)/)
        if (samplingMatch) nodeStatus.sflowSampling = Number.parseInt(samplingMatch[1], 10)
        const pollingMatch = sflowResult.output.match(/polling\s*:\s*(\d+)/)
        if (pollingMatch) nodeStatus.sflowPolling = Number.parseInt(pollingMatch[1], 10)
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
              connection_id: connId,
              node: nodeName,
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

