// Config-derived VM fields (spec D9). /cluster/resources returns NO config
// field; /config returns exactly what #254 asks for (config drift: cpu type,
// disk controller; guest agent flag). Served by default at a measured cost of
// about 5.1s cold for 500 VMs, behind a cache whose stale window is 15 min.
// The agent PROBE is 7x more expensive and only meaningful on running VMs, so
// it sits behind an explicit opt-in. The same /config read also yields the
// search identity of the guest (MACs, static IPs, description; #223, #861),
// parsed by guestNetIdentity.ts at no extra call.
import { pveFetch } from "@/lib/proxmox/client"
import { DaemonSlotExpired } from "@/lib/proxmox/daemonSlots"
import { callGuestAgent } from "@/lib/proxmox/guestAgentCall"

import { mapWithConcurrency, PVEPROXY_CONCURRENCY } from "./concurrency"
import { EMPTY_GUEST_NET_IDENTITY, parseGuestNetIdentity, type GuestNetIdentity } from "./guestNetIdentity"
import { sumGuestConfigDisks } from "./guestConfigDisks"

export type VmConfigFields = {
  cpuType: string | null
  scsihw: string | null
  agentEnabled: boolean
  bios: string | null
  ostype: string | null
  /** `machine` as configured, null for the Proxmox default (i440fx). */
  machine: string | null
  /** Unix seconds of the `meta: ctime=` PVE 7+ writes at creation, null without it (#1163). */
  createdAt: number | null
  onboot: boolean
  cores: number | null
  sockets: number | null
  memoryMb: number | null
}

export type VmAgentProbe = {
  agentResponding: boolean
  agentOsName: string | null
  /** Version the agent reports through /agent/info (#1163). */
  agentVersion: string | null
}

export type EnrichableVm = {
  vmid: string
  node: string
  type: string
  status: string
}

const EMPTY_CONFIG: VmConfigFields = {
  cpuType: null,
  scsihw: null,
  agentEnabled: false,
  bios: null,
  ostype: null,
  machine: null,
  createdAt: null,
  onboot: false,
  cores: null,
  sockets: null,
  memoryMb: null,
}

/** The Proxmox `agent` property is a property-list string: "1", "0", "enabled=1,type=virtio". */
function parseAgentFlag(raw: unknown): boolean {
  if (raw === undefined || raw === null) return false
  const text = String(raw)
  const enabled = /(?:^|,)enabled=([01])/.exec(text)
  if (enabled) return enabled[1] === "1"
  return text.startsWith("1")
}

function parseMetaCtime(raw: unknown): number | null {
  const match = /(?:^|,)\s*ctime=(\d+)/.exec(String(raw ?? ""))
  const ctime = match ? Number(match[1]) : 0

  return ctime > 0 ? ctime : null
}

function num(raw: unknown): number | null {
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : null
}

export function parseVmConfig(config: Record<string, any> | null): VmConfigFields {
  if (!config) return { ...EMPTY_CONFIG }
  return {
    cpuType: config.cpu ? String(config.cpu) : null,
    scsihw: config.scsihw ? String(config.scsihw) : null,
    agentEnabled: parseAgentFlag(config.agent),
    bios: config.bios ? String(config.bios) : null,
    ostype: config.ostype ? String(config.ostype) : null,
    machine: config.machine ? String(config.machine) : null,
    createdAt: parseMetaCtime(config.meta),
    onboot: String(config.onboot ?? "0") === "1",
    cores: num(config.cores),
    sockets: num(config.sockets),
    memoryMb: num(config.memory),
  }
}

export async function enrichVmsWithConfig<T extends EnrichableVm>(
  connData: any,
  vms: T[],
  // Three states, not two: `null` means the `/nodes` call itself failed, so
  // node status is UNKNOWN for every VM -- that is not a valid "offline"
  // verdict and must not be treated as one (a failed /nodes with a fulfilled
  // /cluster/resources is evidence the connection IS reachable). A Set means
  // node status is known: membership is online, absence is confirmed offline
  // and skips the call entirely.
  onlineNodes: Set<string> | null,
  // `agentDeadline` (epoch ms): a probe that could not start before it is not
  // sent, and leaves the agent fields unset (unknown), not "not responding".
  opts: { includeAgent?: boolean; agentDeadline?: number } = {},
): Promise<Array<T & VmConfigFields & GuestNetIdentity & Partial<VmAgentProbe> & { diskTotal?: number | null }>> {
  return mapWithConcurrency(vms, PVEPROXY_CONCURRENCY, async (vm) => {
    // Confirmed-offline node: no call at all. Every per-guest call to a dead
    // node fails with HTTP 595 after about 1s (measured, spec section 9).
    // Unknown status (onlineNodes === null) falls through to the fetch below
    // instead of being silently treated as offline.
    if (onlineNodes !== null && !onlineNodes.has(vm.node)) {
      return { ...vm, ...EMPTY_CONFIG, ...EMPTY_GUEST_NET_IDENTITY }
    }

    const kind = vm.type === "lxc" ? "lxc" : "qemu"
    let config: Record<string, any> | null = null
    try {
      config = await pveFetch<Record<string, any>>(
        connData,
        `/nodes/${encodeURIComponent(vm.node)}/${kind}/${encodeURIComponent(vm.vmid)}/config`,
      )
    } catch {
      // A failing /config never fails the route.
    }
    const fields = parseVmConfig(config)
    // #938: the sum of every disk, from the same read. null without a config.
    const enriched = { ...vm, ...fields, ...parseGuestNetIdentity(config, kind), diskTotal: sumGuestConfigDisks(config, kind) }

    if (!opts.includeAgent) return enriched
    // The flag means "the admin ticked the box"; the probe means "the agent is
    // installed and running" (spec section 9). Only worth 7x the cost on a
    // running VM whose flag is ON.
    if (kind !== "qemu" || vm.status !== "running" || !fields.agentEnabled) {
      return { ...enriched, agentResponding: false, agentOsName: null, agentVersion: null }
    }
    // Protected calls: through the node's pvedaemon slots, and an agent that
    // did not answer is left alone for a while (roadmap#179).
    let agentVersion: string | null = null
    try {
      // /agent/info answers on every agent version: it is the liveness probe,
      // and get-osinfo, which old agents lack, is only asked once it answered.
      const info = await callGuestAgent<any>(connData, vm.node, vm.vmid, "info", { deadline: opts.agentDeadline })
      agentVersion = info?.result?.version ? String(info.result.version) : null
    } catch (err) {
      if (err instanceof DaemonSlotExpired) return enriched
      return { ...enriched, agentResponding: false, agentOsName: null, agentVersion: null }
    }
    try {
      const info = await callGuestAgent<any>(connData, vm.node, vm.vmid, "get-osinfo", { deadline: opts.agentDeadline, mute: false })
      const name = info?.result?.["pretty-name"] ?? info?.result?.name ?? null
      return { ...enriched, agentResponding: true, agentOsName: name ? String(name) : null, agentVersion }
    } catch {
      return { ...enriched, agentResponding: true, agentOsName: null, agentVersion }
    }
  })
}
