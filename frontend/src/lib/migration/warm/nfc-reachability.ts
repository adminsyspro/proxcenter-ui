// Can the Proxmox node reach the ESXi address the copy will use (roadmap#53)?
//
// The VDDK on the node opens the NFC data connection to the ESXi host on port
// 902 and, when it connects to the host directly, the API connection on 443;
// on a vCenter source the API connection goes to the vCenter (roadmap#175).
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

/**
 * One `port-N=open|closed` line per port, each probe bounded to a few seconds.
 * The address is read by the inner `bash -c`, so the outer shellEscape alone
 * would not protect it: the builder refuses anything but a host name or IP.
 */
export function buildPortProbeCmd(address: string, ports: number[]): string {
  if (!isValidCopyAddress(address)) throw new Error(`Invalid copy address: ${JSON.stringify(address)}`)
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
  /** vCenter source: the vCenter the VDDK logs in to, probed from the same node (roadmap#175). */
  vcenter?: VcenterReachability
}

/**
 * On a vCenter source the VDDK's `server=` is the vCenter: the node opens the
 * API session and reads the certificate there on 443, and only the data goes
 * to the host on 902. The name the connection was registered with may resolve
 * for ProxCenter and not for the node, so a name is resolved first.
 */
export interface VcenterReachability {
  host: string
  /** Name resolved on the node (always true for an IP). */
  resolved: boolean
  /** Port 443 answered. */
  open: boolean
}

/** A URL hostname keeps the brackets of an IPv6 literal; /dev/tcp and openssl want them off. */
export function bareHost(host: string): string {
  return host.replace(/^\[(.*)\]$/, "$1")
}

const isIpLiteral = (host: string) => /^[0-9.]+$/.test(host) || host.includes(":")

/** `vcenter-resolve=ok|fail` (names only) and `vcenter-443=open|closed`, bounded like the port probe. */
export function buildVcenterProbeCmd(host: string): string {
  const h = bareHost(host)
  if (!isValidCopyAddress(h)) throw new Error(`Invalid vCenter address: ${JSON.stringify(host)}`)
  const resolve = isIpLiteral(h)
    ? ""
    : `if timeout ${PROBE_TIMEOUT_SEC} getent hosts ${shellEscape(h)} >/dev/null; then echo "vcenter-resolve=ok"; else echo "vcenter-resolve=fail"; fi; `
  return resolve + `if timeout ${PROBE_TIMEOUT_SEC} bash -c ${shellEscape(`exec 3<>/dev/tcp/${h}/${API_PORT}`)} 2>/dev/null; then echo "vcenter-${API_PORT}=open"; else echo "vcenter-${API_PORT}=closed"; fi`
}

export function parseVcenterProbe(output: string | undefined, host: string): VcenterReachability {
  const out = output ?? ""
  return { host: bareHost(host), resolved: !/^vcenter-resolve=fail$/m.test(out), open: new RegExp(`^vcenter-${API_PORT}=open$`, "m").test(out) }
}

/**
 * Probe `address` from the node on the given ports (default: 902 and 443) and,
 * with `vcenterHost`, the vCenter on 443 in the same SSH session.
 */
export async function checkNfcReachability(connectionId: string, nodeIp: SshTarget, address: string, ports: number[] = [NFC_PORT, API_PORT], vcenterHost?: string): Promise<NfcReachability> {
  if (!isValidCopyAddress(address)) return { address: String(address), ports: {}, ok: false, error: "invalid address" }
  if (vcenterHost !== undefined && !isValidCopyAddress(bareHost(vcenterHost))) return { address, ports: {}, ok: false, error: "invalid vCenter address" }
  const cmd = [buildPortProbeCmd(address, ports), ...(vcenterHost ? [buildVcenterProbeCmd(vcenterHost)] : [])].join("; ")
  const probes = ports.length + (vcenterHost ? 2 : 0)
  const res = await executeSSH(connectionId, nodeIp, cmd, (PROBE_TIMEOUT_SEC * probes + 10) * 1000)
  if (!res.success && !(res.output ?? "").includes("port-")) {
    return { address, ports: {}, ok: false, error: res.error || res.output || "probe failed" }
  }
  const parsed = parsePortProbe(res.output, ports)
  const vcenter = vcenterHost ? parseVcenterProbe(res.output, vcenterHost) : undefined
  return { address, ports: parsed, ok: ports.every(p => parsed[p]) && (!vcenter || vcenter.open), ...(vcenter && { vcenter }) }
}

/** Operator-facing sentence for a vCenter the node cannot reach. */
export function describeVcenterUnreachable(v: VcenterReachability): string {
  if (!v.resolved) return `The Proxmox node cannot resolve the vCenter name ${v.host}, which the VDDK on the node logs in to: add it to the node's DNS or /etc/hosts.`
  return `The Proxmox node cannot reach the vCenter ${v.host} on port ${API_PORT}, where the VDDK on the node logs in: open the route and the firewall from the node to the vCenter.`
}

/** Operator-facing sentence for a failed probe. */
export function describeUnreachable(r: NfcReachability, hostLabel: string): string {
  if (r.error) return `Could not probe ${r.address} (${hostLabel}) from the Proxmox node: ${r.error}`
  const closed = Object.entries(r.ports).filter(([, open]) => !open).map(([p]) => p)
  const sentences = [
    ...(r.vcenter && !r.vcenter.open ? [describeVcenterUnreachable(r.vcenter)] : []),
    ...(closed.length ? [`The Proxmox node cannot reach ${r.address} (${hostLabel}) on port ${closed.join(" and ")}. The copy goes through this VMkernel adapter: route the node to that network, open the ESXi firewall for it, or pick another adapter.`] : []),
  ]
  return sentences.join(" ")
}

/**
 * Dialog-side probe: resolve the node the way the engine does (same SSH
 * endpoint as runWarmMigration) and check the chosen copy address from it.
 * `direct` adds port 443: on a standalone ESXi source the VDDK also talks to
 * the API at that address; on a vCenter source it talks to the vCenter, which
 * `vcenterHost` probes on 443.
 */
export async function runWarmCopyReachability(connectionId: string, node: string, address: string, direct: boolean, vcenterHost?: string): Promise<NfcReachability> {
  const { getConnectionById } = await import("@/lib/connections/getConnection")
  const { getNodeSshEndpointForMigration } = await import("../pve-tasks")
  const { prisma } = await import("@/lib/db/prisma")
  const conn = await getConnectionById(connectionId)
  const nodeIp = await getNodeSshEndpointForMigration(prisma, connectionId, node, conn.baseUrl)
  return checkNfcReachability(connectionId, nodeIp, address, direct ? [NFC_PORT, API_PORT] : [NFC_PORT], direct ? undefined : vcenterHost)
}
