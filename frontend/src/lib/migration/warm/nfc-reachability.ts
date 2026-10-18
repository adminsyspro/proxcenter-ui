// Can the Proxmox node reach the ESXi address the copy will use (roadmap#53)?
//
// The VDDK on the node opens the NFC data connection to the ESXi host on port
// 902 and, when it connects to the host directly, the API connection on 443.
// Once the copy is steered to a dedicated VMkernel adapter (backup network),
// the management network no longer says anything about reachability: the node
// needs a route to that network. Probed from the node itself, before anything
// is allocated, with bash's /dev/tcp so nothing has to be installed.

import { executeSSH, shellEscape } from "@/lib/ssh/exec"
import { type SshTarget } from "@/lib/ssh/node-endpoint-core"

/** NFC data port of ESXi (vmware-authd). */
export const NFC_PORT = 902
/** vSphere API / VDDK control port. */
export const API_PORT = 443

const PROBE_TIMEOUT_SEC = 5

/** IPv4, IPv6 or a host name: the only characters the probe interpolates. */
export function isValidCopyAddress(address: unknown): address is string {
  return typeof address === "string" && address.length > 0 && address.length <= 253 && /^[A-Za-z0-9.:_-]+$/.test(address)
}

/** One `port-N=open|closed` line per port, each probe bounded to a few seconds. */
export function buildPortProbeCmd(address: string, ports: number[]): string {
  return ports
    .filter(p => Number.isInteger(p) && p > 0 && p < 65536)
    .map(p => `if timeout ${PROBE_TIMEOUT_SEC} bash -c ${shellEscape(`exec 3<>/dev/tcp/${address}/${p}`)} 2>/dev/null; then echo "port-${p}=open"; else echo "port-${p}=closed"; fi`)
    .join("; ")
}

/** Parse the probe output into a port -> open map; a port missing from the output is closed. */
export function parsePortProbe(output: string | undefined, ports: number[]): Record<number, boolean> {
  const out: Record<number, boolean> = {}
  for (const p of ports) out[p] = new RegExp(`^port-${p}=open$`, "m").test(output ?? "")
  return out
}

export interface NfcReachability {
  address: string
  /** Port -> reachable from the node. */
  ports: Record<number, boolean>
  /** Every requested port answered. */
  ok: boolean
  /** Probe could not run (SSH failure): ports are unknown, `ok` is false. */
  error?: string
}

/** Probe `address` from the node on the given ports (default: 902 and 443). */
export async function checkNfcReachability(connectionId: string, nodeIp: SshTarget, address: string, ports: number[] = [NFC_PORT, API_PORT]): Promise<NfcReachability> {
  if (!isValidCopyAddress(address)) return { address: String(address), ports: {}, ok: false, error: "invalid address" }
  const res = await executeSSH(connectionId, nodeIp, buildPortProbeCmd(address, ports), (PROBE_TIMEOUT_SEC * ports.length + 10) * 1000)
  if (!res.success && !(res.output ?? "").includes("port-")) {
    return { address, ports: {}, ok: false, error: res.error || res.output || "probe failed" }
  }
  const parsed = parsePortProbe(res.output, ports)
  return { address, ports: parsed, ok: ports.every(p => parsed[p]) }
}

/** Operator-facing sentence for a failed probe. */
export function describeUnreachable(r: NfcReachability, hostLabel: string): string {
  if (r.error) return `Could not probe ${r.address} (${hostLabel}) from the Proxmox node: ${r.error}`
  const closed = Object.entries(r.ports).filter(([, open]) => !open).map(([p]) => p)
  return `The Proxmox node cannot reach ${r.address} (${hostLabel}) on port ${closed.join(" and ")}. The copy goes through this VMkernel adapter: route the node to that network, open the ESXi firewall for it, or pick another adapter.`
}

/**
 * Dialog-side probe: resolve the node the way the engine does (same SSH
 * endpoint as runWarmMigration) and check the chosen copy address from it.
 * `direct` adds port 443: on a standalone ESXi source the VDDK also talks to
 * the API at that address, on a vCenter source only the NFC data port matters.
 */
export async function runWarmCopyReachability(connectionId: string, node: string, address: string, direct: boolean): Promise<NfcReachability> {
  const { getConnectionById } = await import("@/lib/connections/getConnection")
  const { getNodeSshEndpointForMigration } = await import("../pve-tasks")
  const { prisma } = await import("@/lib/db/prisma")
  const conn = await getConnectionById(connectionId)
  const nodeIp = await getNodeSshEndpointForMigration(prisma, connectionId, node, conn.baseUrl)
  return checkNfcReachability(connectionId, nodeIp, address, direct ? [NFC_PORT, API_PORT] : [NFC_PORT])
}
