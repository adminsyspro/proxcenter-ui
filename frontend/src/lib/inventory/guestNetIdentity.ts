// Search identity of a guest, read from its PVE config: MAC addresses, the
// IPs pinned statically in the config and the free-text description (#223,
// #861). Everything here comes from /nodes/{node}/{qemu|lxc}/{vmid}/config,
// which /api/v1/vms already fetches for #254, so indexing these fields costs
// no extra call and works on a stopped guest. Live addresses (guest agent,
// LXC /interfaces) are the job of guestIpIndex.ts.
import { isSearchableIp } from "@/lib/net/ip"

export type GuestNetIdentity = {
  /** Uppercase, colon separated, deduplicated. Empty when PVE auto-assigns. */
  macs: string[]
  /** Static IPs of the config: LXC `netN` ip=/ip6=, QEMU `ipconfigN` ip=/ip6=. Prefix stripped. */
  configIps: string[]
  description: string | null
}

export type LiveGuestAddresses = { ips: string[]; macs: string[] }

export const EMPTY_GUEST_NET_IDENTITY: GuestNetIdentity = { macs: [], configIps: [], description: null }

const NET_KEY = /^net\d+$/
const IPCONFIG_KEY = /^ipconfig\d+$/
// On read PVE always renders a QEMU NIC as `<model>=<MAC>` first; the
// `macaddr=` form is what our own EditNetworkDialog writes and `hwaddr=` is
// the LXC spelling. All three must be accepted (same lesson as ipamScan.ts).
const QEMU_NIC_MODELS = new Set([
  "virtio", "e1000", "e1000-82540em", "e1000-82544gc", "e1000-82545em", "e1000e",
  "rtl8139", "vmxnet3", "ne2k_pci", "ne2k_isa", "pcnet", "i82551", "i82557b", "i82559er",
])
const MAC_RE = /^[0-9A-F]{2}(?::[0-9A-F]{2}){5}$/
const NULL_MAC = "00:00:00:00:00:00"
const IP_PLACEHOLDERS = new Set(["dhcp", "manual", "auto", ""])

export function normalizeMac(raw: unknown): string | null {
  if (typeof raw !== "string") return null
  const mac = raw.trim().replace(/-/g, ":").toUpperCase()
  return MAC_RE.test(mac) && mac !== NULL_MAC ? mac : null
}

function splitProps(line: string): Array<[string, string]> {
  const out: Array<[string, string]> = []
  for (const part of line.split(",")) {
    const eq = part.indexOf("=")
    if (eq < 0) continue
    out.push([part.slice(0, eq).trim(), part.slice(eq + 1).trim()])
  }
  return out
}

function stripPrefix(value: string): string {
  return value.split("/")[0].trim()
}

function staticIp(value: string): string | null {
  const ip = stripPrefix(value)
  if (IP_PLACEHOLDERS.has(ip.toLowerCase())) return null
  return isSearchableIp(ip) ? ip : null
}

export function parseGuestNetIdentity(config: Record<string, unknown> | null, type: string): GuestNetIdentity {
  if (!config) return { ...EMPTY_GUEST_NET_IDENTITY }
  const isLxc = type === "lxc"
  const macs = new Set<string>()
  const ips = new Set<string>()

  for (const [key, value] of Object.entries(config)) {
    if (typeof value !== "string") continue
    if (NET_KEY.test(key)) {
      for (const [k, v] of splitProps(value)) {
        if (k === "macaddr" || k === "hwaddr" || (!isLxc && QEMU_NIC_MODELS.has(k))) {
          const mac = normalizeMac(v)
          if (mac) macs.add(mac)
        } else if (isLxc && (k === "ip" || k === "ip6")) {
          const ip = staticIp(v)
          if (ip) ips.add(ip)
        }
      }
    } else if (!isLxc && IPCONFIG_KEY.test(key)) {
      for (const [k, v] of splitProps(value)) {
        if (k !== "ip" && k !== "ip6") continue
        const ip = staticIp(v)
        if (ip) ips.add(ip)
      }
    }
  }

  const description = typeof config.description === "string" && config.description.trim() ? config.description : null
  return { macs: [...macs], configIps: [...ips], description }
}

/**
 * Addresses reported live by the guest. Accepts both the QEMU guest agent
 * `network-get-interfaces` payload (`{ result: [...] }`, `ip-addresses[]`) and
 * the LXC `/interfaces` list (`inet`/`inet6` plus the same `ip-addresses[]`).
 * Loopback and link-local are dropped, so a guest that only has a fe80:: yet
 * (DHCP still pending) yields no IP and keeps its last known one.
 */
export function extractLiveAddresses(payload: unknown): LiveGuestAddresses {
  const list: unknown[] = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as { result?: unknown })?.result) ? (payload as { result: unknown[] }).result : []
  const ips = new Set<string>()
  const macs = new Set<string>()

  for (const entry of list) {
    if (!entry || typeof entry !== "object") continue
    const iface = entry as Record<string, unknown>
    const mac = normalizeMac(iface["hardware-address"] ?? iface.hwaddr)
    if (mac) macs.add(mac)
    const addresses = Array.isArray(iface["ip-addresses"]) ? iface["ip-addresses"] as Array<Record<string, unknown>> : []
    for (const a of addresses) {
      const ip = typeof a?.["ip-address"] === "string" ? a["ip-address"] : ""
      if (isSearchableIp(ip)) ips.add(ip)
    }
    for (const key of ["inet", "inet6"]) {
      const raw = iface[key]
      if (typeof raw !== "string") continue
      const ip = stripPrefix(raw)
      if (isSearchableIp(ip)) ips.add(ip)
    }
  }

  return { ips: [...ips], macs: [...macs] }
}
