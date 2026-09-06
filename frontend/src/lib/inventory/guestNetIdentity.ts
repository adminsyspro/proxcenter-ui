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

function addMac(target: Set<string>, raw: unknown): void {
  const mac = normalizeMac(raw)
  if (mac) target.add(mac)
}

function addStaticIp(target: Set<string>, raw: string): void {
  const ip = staticIp(raw)
  if (ip) target.add(ip)
}

/** One `netN` line: the MAC under any of its three spellings, plus the LXC static ip=/ip6=. */
function collectNetLine(line: string, isLxc: boolean, macs: Set<string>, ips: Set<string>): void {
  for (const [k, v] of splitProps(line)) {
    if (k === "macaddr" || k === "hwaddr" || (!isLxc && QEMU_NIC_MODELS.has(k))) addMac(macs, v)
    else if (isLxc && (k === "ip" || k === "ip6")) addStaticIp(ips, v)
  }
}

/** One cloud-init `ipconfigN` line: static ip=/ip6= only. */
function collectIpconfigLine(line: string, ips: Set<string>): void {
  for (const [k, v] of splitProps(line)) {
    if (k === "ip" || k === "ip6") addStaticIp(ips, v)
  }
}

export function parseGuestNetIdentity(config: Record<string, unknown> | null, type: string): GuestNetIdentity {
  if (!config) return { ...EMPTY_GUEST_NET_IDENTITY }
  const isLxc = type === "lxc"
  const macs = new Set<string>()
  const ips = new Set<string>()

  for (const [key, value] of Object.entries(config)) {
    if (typeof value !== "string") continue
    if (NET_KEY.test(key)) collectNetLine(value, isLxc, macs, ips)
    else if (!isLxc && IPCONFIG_KEY.test(key)) collectIpconfigLine(value, ips)
  }

  const description = typeof config.description === "string" && config.description.trim() ? config.description : null
  return { macs: [...macs], configIps: [...ips], description }
}

/** The agent answers `{ result: [...] }`, the LXC endpoint a bare array. */
function interfaceList(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload
  const result = (payload as { result?: unknown } | null)?.result
  return Array.isArray(result) ? result : []
}

function addLiveIp(target: Set<string>, raw: unknown): void {
  if (typeof raw !== "string") return
  const ip = stripPrefix(raw)
  if (isSearchableIp(ip)) target.add(ip)
}

function collectInterface(iface: Record<string, unknown>, ips: Set<string>, macs: Set<string>): void {
  addMac(macs, iface["hardware-address"] ?? iface.hwaddr)
  const addresses = Array.isArray(iface["ip-addresses"]) ? iface["ip-addresses"] as Array<Record<string, unknown>> : []
  for (const a of addresses) addLiveIp(ips, a?.["ip-address"])
  addLiveIp(ips, iface.inet)
  addLiveIp(ips, iface.inet6)
}

/**
 * Addresses reported live by the guest. Accepts both the QEMU guest agent
 * `network-get-interfaces` payload (`{ result: [...] }`, `ip-addresses[]`) and
 * the LXC `/interfaces` list (`inet`/`inet6` plus the same `ip-addresses[]`).
 * Loopback and link-local are dropped, so a guest that only has a fe80:: yet
 * (DHCP still pending) yields no IP and keeps its last known one.
 */
export function extractLiveAddresses(payload: unknown): LiveGuestAddresses {
  const ips = new Set<string>()
  const macs = new Set<string>()

  for (const entry of interfaceList(payload)) {
    if (entry && typeof entry === "object") collectInterface(entry as Record<string, unknown>, ips, macs)
  }

  return { ips: [...ips], macs: [...macs] }
}
