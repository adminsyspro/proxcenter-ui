// src/lib/vdc/transport.ts
// VXLAN transport of a vDC's SDN zone (#899): how the zone's peers are
// derived and which MTU the zone carries. Pure module shared by the vDC
// library, the API routes and the settings dialog, so no Node-only import
// (`net` would break the client bundle).

export type VxlanTransportMode = 'cluster' | 'peers' | 'transport'

export interface VdcTransport {
  mode: VxlanTransportMode
  /** `peers` mode: the whole peer list. `transport` mode: endpoints outside
   *  the node segment (tenant routers ingesting the VXLAN stream, hardware
   *  VTEPs, another cluster). Always empty in `cluster` mode. */
  peers: string[]
  /** Zone MTU as PVE defines it: the MTU of the VNets, underlay minus 50.
   *  Null = PVE default (1450, or the local peer interface MTU minus 50). */
  mtu: number | null
  /** `transport` mode only: VLAN id of the dedicated segment. */
  vlanId: number | null
  /** `transport` mode only: underlay device the VLAN rides on (`bond0`, `vmbr0`). */
  device: string | null
  /** `transport` mode only: the segment, e.g. `10.100.5.0/24`. */
  cidr: string | null
  /** `transport` mode only: node name to its address on the segment. */
  nodeAddresses: Record<string, string>
}

export const DEFAULT_TRANSPORT: VdcTransport = {
  mode: 'cluster',
  peers: [],
  mtu: null,
  vlanId: null,
  device: null,
  cidr: null,
  nodeAddresses: {},
}

export const TRANSPORT_MODES: readonly VxlanTransportMode[] = ['cluster', 'peers', 'transport']

/** VXLAN adds 50 bytes to every frame: the underlay must carry zone MTU + 50. */
export const VXLAN_OVERHEAD = 50
/** IPv6 minimum link MTU, nothing smaller is usable by a guest. */
export const ZONE_MTU_MIN = 1280
/** 9050 on the underlay, the usual jumbo ceiling. */
export const ZONE_MTU_MAX = 9000
/** IFNAMSIZ - 1 */
export const IFACE_NAME_MAX = 15

const ERR = 'VXLAN transport:'

// ---------------------------------------------------------------------------
// IP parsing
// ---------------------------------------------------------------------------

// The project targets ES2017, where BigInt literals (`1n`) do not compile;
// the BigInt() constructor does.
const ZERO = BigInt(0)
const ONE = BigInt(1)
const SIXTEEN = BigInt(16)
const GROUP_MASK = BigInt(0xffff)
const V4_ALL = (ONE << BigInt(32)) - ONE
const V6_ALL = (ONE << BigInt(128)) - ONE

export function parseIPv4(s: string): number | null {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(String(s ?? '').trim())
  if (!m) return null
  let v = 0
  for (let i = 1; i <= 4; i++) {
    const o = Number(m[i])
    if (o > 255) return null
    v = v * 256 + o
  }
  return v
}

export function formatIPv4(n: number): string {
  return `${(n >>> 24) & 255}.${(n >>> 16) & 255}.${(n >>> 8) & 255}.${n & 255}`
}

export function parseIPv6(s: string): bigint | null {
  const str = String(s ?? '').trim().toLowerCase()
  if (!str || /[^0-9a-f:.]/.test(str)) return null
  const dbl = str.split('::')
  if (dbl.length > 2) return null
  const head = dbl[0] ? dbl[0].split(':') : []
  const tail = dbl.length === 2 && dbl[1] ? dbl[1].split(':') : []

  const expand = (parts: string[], out: number[]): boolean => {
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i]
      if (p.includes('.')) {
        // Embedded IPv4, only allowed as the last group (`::ffff:10.0.0.1`).
        if (i !== parts.length - 1) return false
        const v4 = parseIPv4(p)
        if (v4 === null) return false
        out.push(Math.floor(v4 / 65536), v4 % 65536)
        continue
      }
      if (!/^[0-9a-f]{1,4}$/.test(p)) return false
      out.push(parseInt(p, 16))
    }
    return true
  }

  const h: number[] = []
  const t: number[] = []
  if (!expand(head, h) || !expand(tail, t)) return null
  let groups: number[]
  if (dbl.length === 2) {
    const missing = 8 - h.length - t.length
    if (missing < 1) return null
    groups = [...h, ...new Array<number>(missing).fill(0), ...t]
  } else {
    if (h.length !== 8) return null
    groups = h
  }
  let v = ZERO
  for (const g of groups) v = (v << SIXTEEN) | BigInt(g)
  return v
}

export function formatIPv6(v: bigint): string {
  const groups: number[] = []
  for (let i = 7; i >= 0; i--) groups.push(Number((v >> BigInt(i * 16)) & GROUP_MASK))
  // Compress the longest run of zero groups (at least two long), RFC 5952.
  let bestStart = -1
  let bestLen = 0
  for (let i = 0; i < 8; i++) {
    if (groups[i] !== 0) continue
    let j = i
    while (j < 8 && groups[j] === 0) j++
    if (j - i > bestLen) { bestStart = i; bestLen = j - i }
    i = j
  }
  const hex = groups.map(g => g.toString(16))
  if (bestLen < 2) return hex.join(':')
  const left = hex.slice(0, bestStart).join(':')
  const right = hex.slice(bestStart + bestLen).join(':')
  return `${left}::${right}`
}

export function ipFamily(s: string): 4 | 6 | null {
  if (parseIPv4(s) !== null) return 4
  if (parseIPv6(s) !== null) return 6
  return null
}

/** Trimmed, IPv6 lowercased. Null when the text is not an address. */
export function normalizeIp(s: string): string | null {
  const str = String(s ?? '').trim()
  if (parseIPv4(str) !== null) return str
  if (parseIPv6(str) !== null) return str.toLowerCase()
  return null
}

export interface Cidr {
  family: 4 | 6
  prefix: number
  /** Network address as an integer. */
  network: bigint
  /** Canonical text: network address plus prefix. */
  text: string
}

export function parseCidr(s: string): Cidr | null {
  const str = String(s ?? '').trim()
  const slash = str.lastIndexOf('/')
  if (slash < 0) return null
  const ipText = str.slice(0, slash)
  const prefixText = str.slice(slash + 1)
  if (!/^\d{1,3}$/.test(prefixText)) return null
  const prefix = Number(prefixText)
  const v4 = parseIPv4(ipText)
  if (v4 !== null) {
    if (prefix > 32) return null
    const mask = prefix === 0 ? ZERO : V4_ALL ^ ((ONE << BigInt(32 - prefix)) - ONE)
    const network = BigInt(v4) & mask
    return { family: 4, prefix, network, text: `${formatIPv4(Number(network))}/${prefix}` }
  }
  const v6 = parseIPv6(ipText)
  if (v6 !== null) {
    if (prefix > 128) return null
    const mask = prefix === 0 ? ZERO : V6_ALL ^ ((ONE << BigInt(128 - prefix)) - ONE)
    const network = v6 & mask
    return { family: 6, prefix, network, text: `${formatIPv6(network)}/${prefix}` }
  }
  return null
}

function ipToBigint(ip: string, family: 4 | 6): bigint | null {
  if (family === 4) {
    const v = parseIPv4(ip)
    return v === null ? null : BigInt(v)
  }
  return parseIPv6(ip)
}

export function ipInCidr(ip: string, cidr: Cidr): boolean {
  const v = ipToBigint(ip, cidr.family)
  if (v === null) return false
  const bits = cidr.family === 4 ? 32 : 128
  const shift = BigInt(bits - cidr.prefix)
  return (v >> shift) === (cidr.network >> shift)
}

/**
 * The n-th host of a segment (`n` = 1 is the first usable address). Null
 * when it falls outside, or on the IPv4 network / broadcast address.
 */
export function nthAddress(cidr: Cidr, n: number): string | null {
  if (!Number.isInteger(n) || n < 0) return null
  const bits = cidr.family === 4 ? 32 : 128
  const size = ONE << BigInt(bits - cidr.prefix)
  const offset = BigInt(n)
  if (offset >= size) return null
  if (cidr.family === 4) {
    if (cidr.prefix < 31 && (offset === ZERO || offset === size - ONE)) return null
    return formatIPv4(Number(cidr.network + offset))
  }
  return formatIPv6(cidr.network + offset)
}

// ---------------------------------------------------------------------------
// Input normalisation
// ---------------------------------------------------------------------------

function cloneTransport(t: VdcTransport): VdcTransport {
  return { ...t, peers: [...t.peers], nodeAddresses: { ...t.nodeAddresses } }
}

/** Accepts an array, or one string with comma / whitespace separated entries. */
export function normalizePeerList(raw: unknown): string[] {
  const parts: string[] = Array.isArray(raw)
    ? raw.map(p => String(p ?? ''))
    : String(raw ?? '').split(/[\s,;]+/)
  const out: string[] = []
  for (const part of parts) {
    const trimmed = part.trim()
    if (!trimmed) continue
    const ip = normalizeIp(trimmed)
    if (!ip) throw new Error(`${ERR} "${trimmed}" is not a valid IPv4 or IPv6 address.`)
    if (!out.includes(ip)) out.push(ip)
  }
  return out
}

function normalizeMtu(raw: unknown): number | null {
  if (raw === null || raw === undefined || String(raw).trim() === '') return null
  const n = Number(raw)
  if (!Number.isInteger(n) || n < ZONE_MTU_MIN || n > ZONE_MTU_MAX) {
    throw new Error(`${ERR} MTU must be an integer between ${ZONE_MTU_MIN} and ${ZONE_MTU_MAX}.`)
  }
  return n
}

function normalizeVlanId(raw: unknown): number | null {
  if (raw === null || raw === undefined || String(raw).trim() === '') return null
  const n = Number(raw)
  if (!Number.isInteger(n) || n < 1 || n > 4094) {
    throw new Error(`${ERR} VLAN id must be an integer between 1 and 4094.`)
  }
  return n
}

const DEVICE_RE = /^[A-Za-z][A-Za-z0-9_.-]{0,14}$/

function normalizeDevice(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null
  const d = String(raw).trim()
  if (!d) return null
  if (!DEVICE_RE.test(d)) throw new Error(`${ERR} "${d}" is not a valid interface name.`)
  return d
}

function normalizeCidrText(raw: unknown): string | null {
  if (raw === null || raw === undefined) return null
  const s = String(raw).trim()
  if (!s) return null
  const cidr = parseCidr(s)
  if (!cidr) throw new Error(`${ERR} "${s}" is not a valid CIDR (address/prefix).`)
  return cidr.text
}

const NODE_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9-]{0,62}$/

function normalizeNodeAddresses(raw: unknown): Record<string, string> {
  if (raw === null || raw === undefined) return {}
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error(`${ERR} node addresses must be an object of node name to address.`)
  }
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const node = k.trim()
    const text = String(v ?? '').trim()
    if (!text) continue // a node left blank is simply not on the segment
    if (!NODE_NAME_RE.test(node)) throw new Error(`${ERR} "${node}" is not a valid node name.`)
    const ip = normalizeIp(text)
    if (!ip) throw new Error(`${ERR} "${text}" (node ${node}) is not a valid IPv4 or IPv6 address.`)
    out[node] = ip
  }
  return out
}

/**
 * Turn a partial, untrusted input (API body) into a complete transport.
 * Fields left out keep the value of `base`; values that cannot be sent to
 * Proxmox throw, since silently dropping a peer would cut a node off.
 * Fields that do not belong to the chosen mode are cleared, so the stored
 * row always describes exactly what the zone gets.
 */
export function normalizeTransportInput(
  input: Partial<VdcTransport> | null | undefined,
  base: VdcTransport = DEFAULT_TRANSPORT,
): VdcTransport {
  if (!input) return cloneTransport(base)

  const mode: VxlanTransportMode = TRANSPORT_MODES.includes(input.mode as VxlanTransportMode)
    ? (input.mode as VxlanTransportMode)
    : base.mode
  const peers = input.peers === undefined ? [...base.peers] : normalizePeerList(input.peers)
  const mtu = input.mtu === undefined ? base.mtu : normalizeMtu(input.mtu)
  const vlanId = input.vlanId === undefined ? base.vlanId : normalizeVlanId(input.vlanId)
  const device = input.device === undefined ? base.device : normalizeDevice(input.device)
  const cidrText = input.cidr === undefined ? base.cidr : normalizeCidrText(input.cidr)
  const nodeAddresses = input.nodeAddresses === undefined ? { ...base.nodeAddresses } : normalizeNodeAddresses(input.nodeAddresses)

  if (mode === 'cluster') {
    return { mode, peers: [], mtu, vlanId: null, device: null, cidr: null, nodeAddresses: {} }
  }

  if (mode === 'peers') {
    if (peers.length === 0) throw new Error(`${ERR} peer list mode needs at least one peer address.`)
    return { mode, peers, mtu, vlanId: null, device: null, cidr: null, nodeAddresses: {} }
  }

  if (vlanId === null) throw new Error(`${ERR} transport network mode needs a VLAN id.`)
  if (!device) throw new Error(`${ERR} transport network mode needs an underlay device.`)
  if (!cidrText) throw new Error(`${ERR} transport network mode needs the segment CIDR.`)
  const iface = `${device}.${vlanId}`
  if (iface.length > IFACE_NAME_MAX) {
    throw new Error(`${ERR} interface name "${iface}" exceeds ${IFACE_NAME_MAX} characters.`)
  }
  const cidr = parseCidr(cidrText)!
  const entries = Object.entries(nodeAddresses)
  if (entries.length === 0) throw new Error(`${ERR} transport network mode needs an address for at least one node.`)
  for (const [node, ip] of entries) {
    if (!ipInCidr(ip, cidr)) throw new Error(`${ERR} address ${ip} of node ${node} is outside ${cidr.text}.`)
  }
  const seen = new Set<string>()
  for (const ip of [...entries.map(([, ip]) => ip), ...peers]) {
    if (seen.has(ip)) throw new Error(`${ERR} address ${ip} is listed twice.`)
    seen.add(ip)
  }
  return { mode, peers, mtu, vlanId, device, cidr: cidr.text, nodeAddresses }
}

/** The `vdcs` transport columns as Prisma returns them. */
export interface TransportRow {
  vxlanTransportMode?: string | null
  vxlanPeers?: string[] | null
  vxlanMtu?: number | null
  transportVlanId?: number | null
  transportDevice?: string | null
  transportCidr?: string | null
  transportNodeAddresses?: unknown
}

/**
 * Stored row to transport. Rows are validated on write; one edited by hand
 * must not break every listing, so it degrades to cluster mode (keeping the
 * MTU) instead of throwing.
 */
export function transportFromRow(row: TransportRow): VdcTransport {
  const mode = String(row.vxlanTransportMode ?? DEFAULT_TRANSPORT.mode)
  const nodeAddresses = row.transportNodeAddresses
  const raw: VdcTransport = {
    mode: (TRANSPORT_MODES.includes(mode as VxlanTransportMode) ? mode : DEFAULT_TRANSPORT.mode) as VxlanTransportMode,
    peers: Array.isArray(row.vxlanPeers) ? row.vxlanPeers : [],
    mtu: row.vxlanMtu ?? null,
    vlanId: row.transportVlanId ?? null,
    device: row.transportDevice ?? null,
    cidr: row.transportCidr ?? null,
    nodeAddresses:
      nodeAddresses && typeof nodeAddresses === 'object' && !Array.isArray(nodeAddresses)
        ? (nodeAddresses as Record<string, string>)
        : {},
  }
  try {
    return normalizeTransportInput(raw)
  } catch {
    return { ...DEFAULT_TRANSPORT, mtu: raw.mtu }
  }
}

export function transportToRow(transport: VdcTransport) {
  return {
    vxlanTransportMode: transport.mode,
    vxlanPeers: transport.peers,
    vxlanMtu: transport.mtu,
    transportVlanId: transport.vlanId,
    transportDevice: transport.device,
    transportCidr: transport.cidr,
    transportNodeAddresses: transport.nodeAddresses,
  }
}

// ---------------------------------------------------------------------------
// Zone configuration
// ---------------------------------------------------------------------------

export interface ZoneConfig {
  peers: string[]
  mtu: number | null
}

function dedupe(list: string[]): string[] {
  return [...new Set(list)]
}

/**
 * The peers the zone must carry. `clusterNodeIps` are the node addresses
 * from `/cluster/status`, only consulted in `cluster` mode. This is the
 * function a stretched tenant network (#901) will consume.
 */
export function resolveZonePeers(transport: VdcTransport, clusterNodeIps: string[]): string[] {
  switch (transport.mode) {
    case 'peers':
      return dedupe(transport.peers)
    case 'transport':
      return dedupe([...Object.values(transport.nodeAddresses), ...transport.peers])
    default:
      return dedupe(clusterNodeIps)
  }
}

export function zoneConfigFor(transport: VdcTransport, clusterNodeIps: string[]): ZoneConfig {
  return { peers: resolveZonePeers(transport, clusterNodeIps), mtu: transport.mtu ?? null }
}

/** Order-insensitive peer comparison, MTU compared with null = unset. */
export function sameZoneConfig(a: ZoneConfig, b: ZoneConfig): boolean {
  if ((a.mtu ?? null) !== (b.mtu ?? null)) return false
  const sa = new Set(a.peers)
  const sb = new Set(b.peers)
  if (sa.size !== sb.size) return false
  for (const p of sa) if (!sb.has(p)) return false
  return true
}

/** PVE returns `peers` as a comma string; some readers already split it. */
export function parseZonePeers(raw: unknown): string[] {
  if (Array.isArray(raw)) return dedupe(raw.map(p => String(p).trim()).filter(Boolean))
  if (typeof raw === 'string') return dedupe(raw.split(/[\s,;]+/).map(p => p.trim()).filter(Boolean))
  return []
}

/** `bond0.4000`: the VLAN interface a node carries in `transport` mode. */
export function transportIfaceName(transport: Pick<VdcTransport, 'device' | 'vlanId'>): string | null {
  if (!transport.device || transport.vlanId === null) return null
  return `${transport.device}.${transport.vlanId}`
}

/** Why the transports of two vDCs of one cluster cannot coexist (#899). */
export interface TransportConflict {
  reason: 'segment' | 'mtu' | 'nodeAddress' | 'addressReuse' | 'sharedSegment'
  /** The value the other vDC holds, for the message. */
  detail: string
  /** The node the two disagree on, when the reason names one. */
  node?: string
}

const sameAddress = (a: string, b: string): boolean => (normalizeIp(a) ?? a) === (normalizeIp(b) ?? b)

/**
 * Compares the transport of two vDCs of the SAME cluster. Sharing one
 * transport segment is a legitimate montage (a single provider fabric, the
 * tenants isolated by their VNI), so identical definitions are not a
 * conflict. A disagreement is, because both vDCs then write the same VLAN
 * interface on the same nodes and take the address from each other, which
 * leaves the loser's tunnels on whatever address the route picks. Only the
 * `transport` mode provisions an interface, the other two never conflict.
 */
export function transportConflict(a: VdcTransport, b: VdcTransport): TransportConflict | null {
  if (a.mode !== 'transport' || b.mode !== 'transport') return null
  const ifaceA = transportIfaceName(a)
  const ifaceB = transportIfaceName(b)
  if (!ifaceA || !ifaceB) return null
  const cidrA = a.cidr ? parseCidr(a.cidr) : null
  const cidrB = b.cidr ? parseCidr(b.cidr) : null

  if (ifaceA !== ifaceB) {
    // One segment reached through two interfaces: the node would hold two
    // addresses of the same subnet and pick its source route at random.
    if (cidrA && cidrB && cidrA.text === cidrB.text) return { reason: 'sharedSegment', detail: ifaceB }
    return null
  }

  if (cidrA && cidrB && cidrA.text !== cidrB.text) return { reason: 'segment', detail: cidrB.text }
  // The interface carries the zone MTU plus the VXLAN overhead, so two zone
  // MTUs on one interface is the same fight as two addresses.
  if ((a.mtu ?? null) !== (b.mtu ?? null)) {
    return { reason: 'mtu', detail: b.mtu === null ? 'the Proxmox default' : String(b.mtu) }
  }
  for (const [node, ip] of Object.entries(a.nodeAddresses)) {
    const other = b.nodeAddresses[node]
    if (other && !sameAddress(other, ip)) return { reason: 'nodeAddress', node, detail: other }
  }
  // The same address on two different nodes is a duplicate on the segment.
  for (const [node, ip] of Object.entries(b.nodeAddresses)) {
    for (const [ownNode, ownIp] of Object.entries(a.nodeAddresses)) {
      if (ownNode !== node && sameAddress(ownIp, ip)) return { reason: 'addressReuse', node, detail: ip }
    }
  }
  return null
}

/** The MTU the transport interface itself must carry for a given zone MTU. */
export function underlayMtuFor(zoneMtu: number | null): number | null {
  return zoneMtu === null ? null : zoneMtu + VXLAN_OVERHEAD
}

export interface NodeAddressInfo {
  name: string
  addresses: string[]
}

/**
 * Nodes none of whose configured addresses appear in `peers`. Proxmox does
 * not refuse such a zone: the node falls back to its route source address,
 * and the other nodes simply never send it any traffic. A warning, not a block.
 */
export function nodesWithoutPeer(peers: string[], nodes: NodeAddressInfo[]): string[] {
  const set = new Set(peers.map(p => normalizeIp(p) ?? p))
  return nodes
    .filter(n => !n.addresses.some(a => set.has(normalizeIp(a) ?? a)))
    .map(n => n.name)
}

/**
 * Sequential addresses for a node list, first node at `firstOffset`
 * (default 1, the first usable host). Nodes that fall outside the segment
 * are left out.
 */
export function suggestNodeAddresses(cidrText: string, nodeNames: string[], firstOffset = 1): Record<string, string> {
  const cidr = parseCidr(cidrText)
  if (!cidr) return {}
  const out: Record<string, string> = {}
  nodeNames.forEach((name, i) => {
    const ip = nthAddress(cidr, firstOffset + i)
    if (ip) out[name] = ip
  })
  return out
}
