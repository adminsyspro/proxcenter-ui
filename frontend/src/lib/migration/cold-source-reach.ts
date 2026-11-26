/**
 * Can the Proxmox node reach the address the cold vCenter export downloads
 * the disks from?
 *
 * The cold vCenter path (./nfc-export) asks vCenter for an HttpNfcLease and
 * downloads each disk with curl ON THE PROXMOX NODE, from the URL the lease
 * hands out. That URL is not the vCenter's 443: on an on-premises vCenter it
 * is the ESXi host serving the disk (https://<host>/nfc/...), on a hosted
 * vCenter it can be a proxy on another port (https://<vcenter>:8443/nfc/...).
 * ProxCenter reaching the vCenter says nothing about the node reaching that
 * URL, and a node that cannot connect used to wait 134 s for curl to give up.
 *
 * Before the run: on a powered-off VM, open a test lease (ExportVm), read the
 * host:port of its device URLs, abort the lease whatever happens, and probe
 * each of them from the node in one SSH session, bounded like the warm copy
 * probe (./warm/nfc-reachability). A running VM gets no test lease: ExportVm
 * refuses it and the pre-flight takes no snapshot; the job probes the URL
 * itself before downloading (see probeNfcEndpoints in ./nfc-export).
 */
import { decryptSecret } from "@/lib/crypto/secret"
import { executeSSH, shellEscape } from "@/lib/ssh/exec"
import { type SshTarget } from "@/lib/ssh/node-endpoint-core"
import {
  soapLogin,
  soapLogout,
  soapRequest,
  extractProp,
  soapExportVm,
  soapWaitForNfcLease,
  soapNfcLeaseAbort,
  type SoapSession,
  type NfcLeaseDeviceUrl,
} from "@/lib/vmware/soap"
import { bareHost, isValidCopyAddress } from "./warm/nfc-reachability"
import { mapBounded } from "./batch-disk-sizes"
import { isValidSourceVmId } from "./source-vm-id"

const PROBE_TIMEOUT_SEC = 5
/** A lease lists one URL per disk; they share one or two endpoints. Past this, the rest is not probed. */
export const MAX_ENDPOINTS = 8
/** Batch: one test lease per source host, a few at a time, within a deadline. */
export const BATCH_LEASE_CONCURRENCY = 2
export const BATCH_DEADLINE_MS = 60_000
export const BATCH_MAX_LEASES = 8

export interface NfcEndpoint {
  host: string
  port: number
}

export interface NfcEndpointReach extends NfcEndpoint {
  /** Name resolved on the node (always true for an IP). */
  resolved: boolean
  /** TCP connection opened from the node. */
  open: boolean
}

export type ColdSourceReach =
  /** Every endpoint answered from the node. */
  | { status: "ok"; node: string; endpoints: NfcEndpointReach[] }
  /** At least one endpoint did not: the download would fail. */
  | { status: "blocked"; node: string; endpoints: NfcEndpointReach[]; message: string }
  /** Nothing to test: a running VM (no test lease) or a standalone ESXi source (no NFC export). */
  | { status: "skipped"; reason: "poweredOn" | "notVcenter" }
  /** The test itself could not run (lease refused, SSH down): advisory, never blocking. */
  | { status: "error"; node: string; error: string }

/** Distinct host:port of the disk URLs of a lease (every URL when none is flagged as a disk). */
export function nfcEndpointsOf(devices: NfcLeaseDeviceUrl[]): NfcEndpoint[] {
  const disks = devices.filter(d => d.disk)
  const out = new Map<string, NfcEndpoint>()
  for (const d of disks.length ? disks : devices) {
    let url: URL
    try {
      url = new URL(d.url)
    } catch {
      continue
    }
    const host = bareHost(url.hostname)
    if (!isValidCopyAddress(host)) continue
    const defaultPort = url.protocol === "http:" ? 80 : 443
    const port = url.port ? Number(url.port) : defaultPort
    out.set(`${host}:${port}`, { host, port })
  }
  return [...out.values()].slice(0, MAX_ENDPOINTS)
}

const isIpLiteral = (host: string) => /^[0-9.]+$/.test(host) || host.includes(":")

/**
 * `ep-<i>-resolve=ok|fail` (names only) then `ep-<i>=open|closed` per endpoint,
 * each step bounded. The host is read by the inner `bash -c`, so only a host
 * name or an IP is ever interpolated (isValidCopyAddress), the port is an integer.
 */
export function buildEndpointProbeCmd(endpoints: NfcEndpoint[]): string {
  return endpoints.map((e, i) => {
    const h = bareHost(e.host)
    if (!isValidCopyAddress(h)) throw new Error(`Invalid NFC host: ${JSON.stringify(e.host)}`)
    if (!Number.isInteger(e.port) || e.port <= 0 || e.port >= 65536) throw new Error(`Invalid NFC port: ${e.port}`)
    const resolve = isIpLiteral(h)
      ? ""
      : `if timeout ${PROBE_TIMEOUT_SEC} getent hosts ${shellEscape(h)} >/dev/null; then echo "ep-${i}-resolve=ok"; else echo "ep-${i}-resolve=fail"; fi; `
    return resolve + `if timeout ${PROBE_TIMEOUT_SEC} bash -c ${shellEscape(`exec 3<>/dev/tcp/${h}/${e.port}`)} 2>/dev/null; then echo "ep-${i}=open"; else echo "ep-${i}=closed"; fi`
  }).join("; ")
}

export function parseEndpointProbe(output: string | undefined, endpoints: NfcEndpoint[]): NfcEndpointReach[] {
  const out = output ?? ""
  return endpoints.map((e, i) => ({
    host: bareHost(e.host),
    port: e.port,
    resolved: !new RegExp(`^ep-${i}-resolve=fail$`, "m").test(out),
    open: new RegExp(`^ep-${i}=open$`, "m").test(out),
  }))
}

/** Probe every endpoint from the node in one SSH session. */
export async function probeNfcEndpoints(connectionId: string, nodeIp: SshTarget, endpoints: NfcEndpoint[]): Promise<{ endpoints: NfcEndpointReach[] } | { error: string }> {
  if (endpoints.length === 0) return { endpoints: [] }
  const cmd = buildEndpointProbeCmd(endpoints)
  const res = await executeSSH(connectionId, nodeIp, cmd, (PROBE_TIMEOUT_SEC * 2 * endpoints.length + 10) * 1000)
  if (!/^ep-\d+=/m.test(res.output ?? "")) return { error: res.error || res.output || "probe failed" }
  return { endpoints: parseEndpointProbe(res.output, endpoints) }
}

/** Operator-facing sentence for the endpoints a node cannot reach (job log, API error). */
export function describeColdUnreachable(node: string, endpoints: NfcEndpointReach[]): string {
  const down = endpoints.filter(e => !e.resolved || !e.open)
  const parts = down.map(e => (e.resolved ? `${e.host}:${e.port}` : `${e.host} (name not resolved on the node)`))
  return `The Proxmox node ${node} cannot reach ${parts.join(", ")}, where the source disks are downloaded from. ` +
    `The download runs on the Proxmox node, not on ProxCenter: allow the node's IP on the vCenter side ` +
    `(for a hosted vCenter, its allowed IPs) and in every firewall in between.`
}

/** Power state and host of a VM in one property call. */
export async function soapGetVmPowerAndHost(session: SoapSession, vmid: string): Promise<{ powerState: string; host: string }> {
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:urn="urn:vim25"><soapenv:Body>` +
    `<urn:RetrievePropertiesEx><urn:_this type="PropertyCollector">${session.propertyCollector}</urn:_this>` +
    `<urn:specSet><urn:propSet><urn:type>VirtualMachine</urn:type><urn:pathSet>runtime.powerState</urn:pathSet><urn:pathSet>runtime.host</urn:pathSet></urn:propSet>` +
    `<urn:objectSet><urn:obj type="VirtualMachine">${vmid}</urn:obj><urn:skip>false</urn:skip></urn:objectSet></urn:specSet><urn:options/></urn:RetrievePropertiesEx>` +
    `</soapenv:Body></soapenv:Envelope>`
  const res = await soapRequest(session.baseUrl, body, session.cookie, session.insecureTLS)
  if (res.text.includes("ManagedObjectNotFound")) throw new Error("VM not found on the VMware source")
  return { powerState: extractProp(res.text, "runtime.powerState").trim(), host: extractProp(res.text, "runtime.host").trim() }
}

/**
 * Open a test export lease on a powered-off VM, read where its disks would be
 * downloaded from, and abort the lease whatever happens: nothing is read.
 */
export async function readExportEndpoints(session: SoapSession, vmid: string): Promise<NfcEndpoint[]> {
  const lease = await soapExportVm(session, vmid)
  try {
    return nfcEndpointsOf(await soapWaitForNfcLease(session, lease))
  } finally {
    // No reason: vCenter shows the test as "canceled by a user", not as an error.
    await soapNfcLeaseAbort(session, lease).catch(() => {})
  }
}

type ConnectionReader = {
  connection: { findUnique: (args: any) => Promise<{ baseUrl: string; apiTokenEnc: string | null; insecureTLS: boolean; type: string } | null> }
}

async function openSourceSession(prisma: ConnectionReader, sourceConnectionId: string): Promise<SoapSession> {
  const conn = await prisma.connection.findUnique({
    where: { id: sourceConnectionId },
    select: { baseUrl: true, apiTokenEnc: true, insecureTLS: true, type: true },
  })
  if (!conn || conn.type !== "vmware" || !conn.apiTokenEnc) throw new Error("VMware connection not found")
  const creds = decryptSecret(conn.apiTokenEnc)
  const i = creds.indexOf(":")
  return soapLogin(conn.baseUrl.replace(/\/$/, ""), i > 0 ? creds.slice(0, i) : "root", i > 0 ? creds.slice(i + 1) : creds, conn.insecureTLS)
}

/** The node's SSH endpoint, resolved the way the migration engine does. */
async function nodeEndpoint(targetConnectionId: string, node: string): Promise<SshTarget> {
  const { getConnectionById } = await import("@/lib/connections/getConnection")
  const { getNodeSshEndpointForMigration } = await import("./pve-tasks")
  const { prisma } = await import("@/lib/db/prisma")
  const conn = await getConnectionById(targetConnectionId)
  return getNodeSshEndpointForMigration(prisma, targetConnectionId, node, conn.baseUrl)
}

function verdict(node: string, probed: { endpoints: NfcEndpointReach[] } | { error: string }): ColdSourceReach {
  if ("error" in probed) return { status: "error", node, error: probed.error }
  if (probed.endpoints.length === 0) return { status: "error", node, error: "the export lease listed no download URL" }
  const down = probed.endpoints.some(e => !e.resolved || !e.open)
  return down
    ? { status: "blocked", node, endpoints: probed.endpoints, message: describeColdUnreachable(node, probed.endpoints) }
    : { status: "ok", node, endpoints: probed.endpoints }
}

/** Single VM: test lease on the source, probe from `node`. Never throws. */
export async function checkColdSourceReach(a: {
  prisma: ConnectionReader
  sourceConnectionId: string
  sourceVmId: string
  targetConnectionId: string
  node: string
}): Promise<ColdSourceReach> {
  if (!isValidSourceVmId(a.sourceVmId)) return { status: "error", node: a.node, error: "invalid VM id" }
  let session: SoapSession
  try {
    session = await openSourceSession(a.prisma, a.sourceConnectionId)
  } catch (e: any) {
    return { status: "error", node: a.node, error: String(e?.message || e) }
  }
  try {
    if (!session.isVcenter) return { status: "skipped", reason: "notVcenter" }
    const { powerState } = await soapGetVmPowerAndHost(session, a.sourceVmId)
    if (powerState !== "poweredOff") return { status: "skipped", reason: "poweredOn" }
    const endpoints = await readExportEndpoints(session, a.sourceVmId)
    return verdict(a.node, await probeNfcEndpoints(a.targetConnectionId, await nodeEndpoint(a.targetConnectionId, a.node), endpoints))
  } catch (e: any) {
    return { status: "error", node: a.node, error: String(e?.message || e) }
  } finally {
    await soapLogout(session).catch(() => {})
  }
}

export interface ColdBatchProblem {
  node: string
  endpoints: NfcEndpointReach[]
  /** VMs whose source host serves the unreachable endpoints. */
  vms: string[]
  message: string
}

export interface ColdBatchReach {
  problems: ColdBatchProblem[]
  /** VMs the check could not cover (running, host unread, lease refused, past the cap). */
  unchecked: string[]
  /** Nodes the probe could not run on: advisory. */
  errors: Array<{ node: string; error: string }>
}

/**
 * Batch: VMs grouped by source host, one test lease per host (on a powered-off
 * VM of it, capped), then every endpoint found probed from each node in one
 * SSH session per node. A node that cannot reach the endpoints of a host
 * blocks the VMs of that host. Never throws.
 */
export async function checkColdBatchSourceReach(a: {
  prisma: ConnectionReader
  sourceConnectionId: string
  targetConnectionId: string
  vms: Array<{ sourceVmId: string; name: string }>
  nodes: string[]
}): Promise<ColdBatchReach> {
  const result: ColdBatchReach = { problems: [], unchecked: [], errors: [] }
  const allUnchecked = () => ({ ...result, unchecked: a.vms.map(v => v.name) })
  let session: SoapSession
  try {
    session = await openSourceSession(a.prisma, a.sourceConnectionId)
  } catch {
    return allUnchecked()
  }
  try {
    if (!session.isVcenter) return allUnchecked()
    const deadline = Date.now() + BATCH_DEADLINE_MS
    const vms = a.vms.filter(v => isValidSourceVmId(v.sourceVmId))
    result.unchecked.push(...a.vms.filter(v => !isValidSourceVmId(v.sourceVmId)).map(v => v.name))
    const states = await mapBounded(vms, 4, deadline, vm => soapGetVmPowerAndHost(session, vm.sourceVmId))
    const byHost = new Map<string, Array<{ sourceVmId: string; name: string }>>()
    vms.forEach((vm, k) => {
      const s = states[k]
      if (!s || s.powerState !== "poweredOff" || !s.host) { result.unchecked.push(vm.name); return }
      byHost.set(s.host, [...(byHost.get(s.host) ?? []), vm])
    })
    const hosts = [...byHost.keys()].slice(0, BATCH_MAX_LEASES)
    for (const h of [...byHost.keys()].slice(BATCH_MAX_LEASES)) result.unchecked.push(...byHost.get(h)!.map(v => v.name))
    const leased = await mapBounded(hosts, BATCH_LEASE_CONCURRENCY, deadline, h => readExportEndpoints(session, byHost.get(h)![0].sourceVmId))
    const endpointsOfHost = new Map<string, NfcEndpoint[]>()
    hosts.forEach((h, k) => {
      const eps = leased[k]
      if (eps && eps.length) endpointsOfHost.set(h, eps)
      else result.unchecked.push(...byHost.get(h)!.map(v => v.name))
    })
    const all = [...new Map([...endpointsOfHost.values()].flat().map(e => [`${e.host}:${e.port}`, e])).values()].slice(0, MAX_ENDPOINTS)
    if (all.length === 0) return result
    for (const node of a.nodes) {
      let probed: { endpoints: NfcEndpointReach[] } | { error: string }
      try {
        probed = await probeNfcEndpoints(a.targetConnectionId, await nodeEndpoint(a.targetConnectionId, node), all)
      } catch (e: any) {
        probed = { error: String(e?.message || e) }
      }
      if ("error" in probed) { result.errors.push({ node, error: probed.error }); continue }
      const reach = new Map(probed.endpoints.map(e => [`${e.host}:${e.port}`, e]))
      const downByKey = new Map<string, ColdBatchProblem>()
      for (const [h, eps] of endpointsOfHost) {
        const down = eps.map(e => reach.get(`${e.host}:${e.port}`)).filter((e): e is NfcEndpointReach => !!e && (!e.resolved || !e.open))
        if (down.length === 0) continue
        const key = down.map(e => `${e.host}:${e.port}`).join(",")
        const p = downByKey.get(key) ?? { node, endpoints: down, vms: [], message: describeColdUnreachable(node, down) }
        p.vms.push(...byHost.get(h)!.map(v => v.name))
        downByKey.set(key, p)
      }
      result.problems.push(...downByKey.values())
    }
    return result
  } catch {
    return allUnchecked()
  } finally {
    await soapLogout(session).catch(() => {})
  }
}
