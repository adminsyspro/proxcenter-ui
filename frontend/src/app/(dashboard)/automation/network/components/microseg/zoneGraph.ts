import type { CSSProperties } from 'react'

import { MarkerType, type Edge, type Node } from '@xyflow/react'

import type { GuestRefLite, MicrosegException, MicrosegFlow, MicrosegSuggestion, MicrosegZone, ZoneState } from '@/lib/microseg/types'
import { serviceLabelIn, serviceName, sharedServiceNames } from '@/lib/network/serviceNames'

import { flowService } from './FlowSummary'
import { outboundFlowStatus, type OutboundFlowStatus } from './outboundStatus'
import { placeEdges, type EdgeEnds, type Obstacle, type PlacedEdge } from './zoneGraphEdges'
import type { Point } from './edgeGeometry'
import { guestId, guestKey } from './zoneModel'
import { GLYPH_Y, GUEST_H, GUEST_R, GUEST_W, byText, circleRadius, foldColumns, layerZones, memberSlots, orderLayers, slotPositions } from './zoneLayout'
import type { NamedNetwork } from '@/lib/microseg/namedNetworks'

/** Size of the External and Outside boxes. */
export const NODE_W = 200
export const NODE_H = 44
/** Room between two columns of circles (rim to rim) and between two circles of a column. */
export const COL_GAP = 240
export const ROW_GAP = 90

export const EXTERNAL_ID = 'external'
export const OUTSIDE_ID = 'outside'
export const UNZONED_ID = 'unzoned'
export const zoneNodeId = (zoneId: string) => `zone:${zoneId}`
export const guestNodeId = (groupId: string, key: string) => `guest:${groupId}:${key}`
export const moreNodeId = (groupId: string) => `more:${groupId}`
/**
 * The circle of a Proxmox node on the node view; its guests carry it as their group. On a shared policy the node is
 * named in its cluster: two clusters may each have a "pve1".
 */
export const pveNodeId = (node: string, cluster?: string) => (cluster ? `pve:${cluster}/${node}` : `pve:${node}`)
export const isPveGroup = (id: string) => id.startsWith('pve:')
/** The node name of a node circle (a node name holds no "/"). */
export const pveNodeName = (id: string) => id.slice(id.lastIndexOf('/') + 1 || 4)
/** The group of the nodes of one cluster on the node view of a shared policy. */
export const pveClusterId = (cluster: string) => `pvecluster:${cluster}`

/**
 * One green for every allowed flow (the zone colour stays on its circle) and, dashed, for the exceptions between guests;
 * blue for blocked, dashed red for unprotected.
 */
export const EDGE_COLORS = { allowed: '#2e7d32', exception: '#2e7d32', blocked: '#1565c0', unprotected: '#e53935', outside: '#9e9e9e' } as const

/** A cluster of a shared policy as the map names it (general words for one outside the user's scope). */
export type MapCluster = { id: string; name: string }

/** A guest drawn on the map. */
export type MapMember = {
  /** The guest: type/VMID on a policy of one cluster, its cluster, type and VMID (`guestId`) on a shared one. */
  key: string
  name: string
  vmid: number
  node: string
  type: 'qemu' | 'lxc'
  status: string
  ips: string[]
  /** Queued for the zone, not tagged yet. */
  pending: boolean
  /** On a shared policy, the cluster of the guest; absent on a policy of one cluster. */
  cluster?: MapCluster
}

export type ZoneNodeData = {
  kind: 'zone'
  zone: MicrosegZone
  /** Null while the guests of the connection are not known. */
  members: number | null
  state: ZoneState
  radius: number
  /** The pending observed flows inside the zone (the compact rendering counts them, it draws no edge for them). */
  inside?: number
  /** The map is inside this zone: it is not offered to enter it. */
  entered?: boolean
}
export type UnzonedNodeData = { kind: 'unzoned'; count: number; radius: number }
export type GuestNodeData = {
  kind: 'guest'
  member: MapMember
  groupId: string
  /** The guest is the target of the map: the colour of the ring around its glyph (its zone's). */
  target?: string
  /** On the node view, the colour of its zone around its glyph (grey in no zone) and the name of that zone (null in none). */
  color?: string
  zone?: string | null
  /** On the node view, a guest that is not running: it cannot be targeted, so it is no button. */
  inert?: boolean
  /** Inside an entered zone: the width of the guest, wide enough for its name. */
  width?: number
}
export type MoreNodeData = { kind: 'more'; count: number; groupId: string }
/** `egress`, on the Outside box: the worst state of the outbound traffic of the zones that send a flow to it. */
export type BoundaryNodeData = { kind: 'external' | 'outside'; egress?: OutboundFlowStatus }
/** An address that talks to a zone and is no guest (the guest view draws the busiest ones on their own). */
export type IpNodeData = { kind: 'ip'; ip: string; /** The zones whose gateway the address is, by name. */ gatewayOf?: string[]; /** The name of the network, when the box stands for a named network (`ip` is then its CIDR). */ network?: string }
/** The guests a zone has on a Proxmox node. */
export type PveZoneShare = { id: string; name: string; color: string; count: number }
/**
 * A Proxmox node of the node view: every guest it holds for Proxmox (`count`, the stopped ones in no zone included,
 * which are not drawn), the zones its drawn guests belong to by name, those in no zone, and the pending observed flows
 * between two of its guests, per kind (no edge stands for them); `inside` is their count for the kinds shown.
 */
export type PveNodeData = {
  kind: 'pveNode'; node: string; count: number; zones: PveZoneShare[]; unzoned: number
  inside: number; insideByKind: { unprotected: number; blocked: number }; radius: number
  /** The status of the node ("online"...) when the page knows it: its icon then carries the status dot. */
  status?: string
  /** On a shared policy, the cluster of the node. */
  cluster?: MapCluster
}
/**
 * A Proxmox node of the connection and the guests it holds, running or not, in a zone or not; `cluster`, on a shared
 * policy, the connection it belongs to.
 */
export type PveNodeInfo = { node: string; guests: number; status?: string; cluster?: string }
/** On the node view of a shared policy, the frame around the nodes of one cluster, headed by its glyph and name. */
export type PveClusterData = { kind: 'pveCluster'; cluster: MapCluster; width: number; height: number }
export type MapNodeData = ZoneNodeData | UnzonedNodeData | GuestNodeData | MoreNodeData | BoundaryNodeData | IpNodeData | PveNodeData | PveClusterData

/** `exception`: what the exceptions of a zone allow from guest to guest, beside the flows of the zones. */
export type MapEdgeKind = 'allowed' | 'exception' | 'unprotected' | 'blocked' | 'outside'

export type MapEdgeData = {
  kind: MapEdgeKind
  /** protocol/ports tokens of the flows (or observed flows) the edge stands for, sorted. */
  services: string[]
  /** The label: the ports grouped per protocol. */
  label: string
  count: number
  /**
   * The log occurrences of the observed flows of the edge, summed (shown after its services); null on an allowed edge:
   * PVE does not log what it lets through, so it has no counter.
   */
  hits: number | null
  /** The allowed flows of the edge (allowed and outside edges). */
  flows: MicrosegFlow[]
  /** The observed flows of the edge (unprotected and blocked edges). */
  observed: MicrosegSuggestion[]
  /** The exceptions the edge stands for, by id: between its two zones, or between its two guests on the guest view. */
  exceptions: MicrosegException[]
  /**
   * How many of them the label counts ("2 exceptions"): those of a link between two zones; 0 on an edge of the guest
   * view, which draws each exception guest to guest, labelled with its services.
   */
  exceptionCount: number
  /** Every flow of the edge is in the draft only (not applied yet). */
  draft: boolean
  /** The ends, and the circles (or boxes) they belong to: the focus mode keeps them lit. */
  fromGroup: string
  toGroup: string
  path: string
  /** The visible edge as a polyline. */
  points: Point[]
  label_x: number
  label_y: number
  label_w: number
  label_h: number
  /** A guest-to-guest edge has a smaller label. */
  small: boolean
  particle: boolean
  color: string
  /** On the node view, the guests the edge stands for, pair by pair with their services (its tooltip lists them). */
  guestPairs?: GuestPair[]
}

/** `key`: the two guests ("qemu/100>qemu/200"), since two guests may carry one name. */
export type GuestPair = { key: string; from: string; to: string; services: string[] }

/** What the flow panel shows of an edge (or of a cell of the matrix): its kind, its flows, its observed flows and its exceptions. */
export type PanelEdgeData = Pick<MapEdgeData, 'kind' | 'color' | 'label' | 'flows' | 'observed' | 'exceptions' | 'exceptionCount'>

export type MapInput = {
  zones: MicrosegZone[]
  flows: MicrosegFlow[]
  suggestions: MicrosegSuggestion[]
  /** The members of each zone; null while the guests are unknown (no guest drawn, counts unknown). */
  members?: ReadonlyMap<string, MapMember[]> | null
  /** The networks the admin named: the views centred on a zone draw the addresses of one as a single box. */
  networks?: readonly NamedNetwork[] | null
  /** The running guests in no zone. */
  unzoned?: MapMember[] | null
  /** Ids of the flows of the draft that are not applied yet. */
  unapplied?: ReadonlySet<string> | null
  /** The exceptions of the draft; drawn only once the members are known. */
  exceptions?: readonly MicrosegException[] | null
  /**
   * The Proxmox nodes of the connection with their guest counts, for the node view; without it that view draws the
   * nodes of the guests it knows and counts those.
   */
  pveNodes?: readonly PveNodeInfo[] | null
  /**
   * The clusters of a shared policy whose guests the map draws (present, with one cluster or more, as soon as the
   * policy is shared): the guest keys then carry the cluster, the exceptions are matched in their own cluster and the
   * node view groups the nodes per cluster, in this order. Absent on a policy of one cluster.
   */
  clusters?: readonly MapCluster[] | null
}

/** The map draws a shared policy (see MapInput.clusters). */
export const isSharedMap = (input: Pick<MapInput, 'clusters'>) => !!input.clusters

export type ZoneGraph = { nodes: Node[]; edges: Edge[] }

const KIND_RANK: Record<MapEdgeKind, number> = { allowed: 0, exception: 1, outside: 2, unprotected: 3, blocked: 4 }

/** The 8 groups of an IPv6 address, or null when it is not one. An IPv4 tail ("::ffff:10.0.0.5") counts for two. */
function ipv6Groups(text: string): number[] | null {
  const v4 = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text)
  let hexText = text
  if (v4) {
    const b = v4.slice(1).map(Number)
    if (b.some(n => n > 255)) return null
    hexText = `${text.slice(0, v4.index)}${(b[0] * 256 + b[1]).toString(16)}:${(b[2] * 256 + b[3]).toString(16)}`
  }
  const hexGroup = (g: string) => (/^[0-9a-f]{1,4}$/.test(g) ? Number.parseInt(g, 16) : Number.NaN)
  const parse = (part: string) => (part === '' ? [] : part.split(':').map(hexGroup))
  const halves = hexText.split('::')
  if (halves.length > 2) return null
  const left = parse(halves[0])
  const right = halves.length === 2 ? parse(halves[1]) : []
  const missing = 8 - left.length - right.length
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null
  const groups = [...left, ...new Array<number>(halves.length === 2 ? missing : 0).fill(0), ...right]
  return groups.every(g => Number.isInteger(g) && g >= 0 && g <= 0xffff) ? groups : null
}

/** RFC 5952 text of 8 groups: no leading zeros, the longest run (2 or more) of zero groups as "::". */
function ipv6Text(groups: number[]): string {
  let best = { at: -1, len: 1 }
  for (let i = 0; i < 8;) {
    if (groups[i] !== 0) { i++; continue }
    let j = i
    while (j < 8 && groups[j] === 0) j++
    if (j - i > best.len) best = { at: i, len: j - i }
    i = j
  }
  const hex = groups.map(g => g.toString(16))
  if (best.at < 0) return hex.join(':')
  return `${hex.slice(0, best.at).join(':')}::${hex.slice(best.at + best.len).join(':')}`
}

/**
 * The canonical text of a guest address, so that the forms of one address meet: "10.0.0.5/24" is "10.0.0.5", an
 * IPv6 address is lowercased and zero-compressed ("2001:DB8:0:0::1" is "2001:db8::1"), and an IPv4-mapped one
 * ("::ffff:10.0.0.5") is its IPv4 address. Anything else is only trimmed and lowercased.
 */
export function bareIp(ip: string): string {
  const text = ip.trim().replace(/\/\d+$/, '').replace(/%.*$/, '').toLowerCase()
  if (!text.includes(':')) return text
  const groups = ipv6Groups(text)
  if (!groups) return text
  if (groups.slice(0, 5).every(g => g === 0) && groups[5] === 0xffff) {
    return [groups[6] >> 8, groups[6] & 255, groups[7] >> 8, groups[7] & 255].join('.')
  }
  return ipv6Text(groups)
}

/** Ports of a protocol in order: numbers first by value, then the rest. */
const portOrder = (a: string, b: string) => (Number.parseInt(a, 10) - Number.parseInt(b, 10)) || byText(a, b)

/**
 * The ports grouped per protocol: "tcp/22, 8080" for one protocol, "tcp 5432 · udp 53" for several; a protocol
 * without port is its name alone ("icmp"). A known port reads as its name ("SSH, HTTP-alt", "PostgreSQL · DNS");
 * a part with a name and an unknown port keeps that one raw ("SSH, tcp/9999").
 */
export function groupServices(services: string[]): string {
  const ports = new Map<string, Set<string>>()
  for (const token of services) {
    const slash = token.indexOf('/')
    const proto = slash < 0 ? token : token.slice(0, slash)
    const set = ports.get(proto) ?? new Set<string>()
    if (slash >= 0) for (const p of token.slice(slash + 1).split(',')) if (p.trim()) set.add(p.trim())
    ports.set(proto, set)
  }
  const protos = [...ports.keys()].sort(byText)
  // A name that several protocols share ("DNS" on tcp and udp) says its protocol.
  const shared = sharedServiceNames(protos.flatMap(proto => [...ports.get(proto)!].map(dport => ({ proto, dport }))))
  const part = (proto: string, sep: string) => {
    const list = [...ports.get(proto)!].sort(portOrder)
    if (!list.length) return proto
    const names = list.map(p => serviceName(proto, p))
    if (names.every(n => n === null)) return `${proto}${sep}${list.join(', ')}`
    return [...new Set(list.map((p, i) => (names[i] ? serviceLabelIn(proto, p, shared) : `${proto}/${p}`)))].join(', ')
  }
  return protos.length === 1 ? part(protos[0], '/') : protos.map(p => part(p, ' ')).join(' · ')
}

/** `all` is every member in name order, `shown` the ones drawn. */
export type Group = { id: string; radius: number; all: MapMember[]; shown: MapMember[]; more: number; data: ZoneNodeData | UnzonedNodeData | PveNodeData }
/** `exceptions`: the exceptions the pair stands for, between its two zones or its two guests (see MapEdgeData.exceptions). */
export type Pair = { kind: MapEdgeKind; source: string; target: string; services: Set<string>; flows: MicrosegFlow[]; observed: MicrosegSuggestion[]; exceptions: MicrosegException[] }
export type Cell = { id: string; w: number; h: number }
export type AddressBooks = Map<string, Map<string, string>>
export type Placement = { nodes: Node[]; obstacles: Obstacle[]; endShapes: Map<string, EdgeEnds> }

export const BOX_SHAPE = { kind: 'box' as const, halfW: NODE_W / 2, halfH: NODE_H / 2 }

export function groupOf(id: string, members: MapMember[] | null, data: Group['data']): Group {
  const list = [...(members ?? [])].sort((a, b) => byText(a.name, b.name) || byText(a.key, b.key))
  const { shown, more } = memberSlots(list.length)
  const radius = circleRadius(shown + (more ? 1 : 0))
  data.radius = radius
  return { id, radius, all: list, shown: list.slice(0, shown), more, data }
}

/** The id a group's guest nodes carry: the zone id, "unzoned", or the id of a Proxmox node's circle. */
const groupKey = (group: Group) => (group.id === UNZONED_ID ? UNZONED_ID : group.id.replace(/^zone:/, ''))

/**
 * Where an address of a group's members is drawn: its guest node, or the "+N" node when it is not drawn. An address
 * two guests share goes to the first by name (whatever the order of the inventory).
 */
export function addressBook(group: Group): Map<string, string> {
  const book = new Map<string, string>()
  const shownKeys = new Set(group.shown.map(m => m.key))
  const groupId = groupKey(group)
  for (const m of group.all) {
    const id = shownKeys.has(m.key) ? guestNodeId(groupId, m.key) : moreNodeId(groupId)
    for (const ip of m.ips) if (!book.has(bareIp(ip))) book.set(bareIp(ip), id)
  }
  return book
}

/** A circle per zone, and one for the running guests in no zone when there are some, with their address books. */
function buildGroups(sorted: MicrosegZone[], members: MapInput['members'], unzoned: MapInput['unzoned']): { groups: Map<string, Group>; books: AddressBooks } {
  const groups = new Map<string, Group>()
  const books: AddressBooks = new Map()
  for (const z of sorted) {
    const list = members ? (members.get(z.id) ?? []) : null
    const g = groupOf(zoneNodeId(z.id), list, { kind: 'zone', zone: z, members: list ? list.length : null, state: z.state, radius: 0 })
    groups.set(g.id, g)
    books.set(z.id, addressBook(g))
  }
  const unzonedList = members && unzoned && unzoned.length > 0 ? unzoned : null
  if (unzonedList) {
    const g = groupOf(UNZONED_ID, unzonedList, { kind: 'unzoned', count: unzonedList.length, radius: 0 })
    groups.set(UNZONED_ID, g)
    books.set(UNZONED_ID, addressBook(g))
  }
  return { groups, books }
}

const pairKey = (p: Pick<Pair, 'kind' | 'source' | 'target'>) => `${p.kind}:${p.source}>${p.target}`
const isObserved = (kind: MapEdgeKind) => kind === 'unprotected' || kind === 'blocked'

export function addPair(
  pairs: Map<string, Pair>, kind: MapEdgeKind, source: string, target: string, service: string, flow?: MicrosegFlow, seen?: MicrosegSuggestion,
  exception?: MicrosegException,
) {
  if (source === target) return
  const key = pairKey({ kind, source, target })
  const pair = pairs.get(key) ?? { kind, source, target, services: new Set<string>(), flows: [], observed: [], exceptions: [] }
  pair.services.add(service)
  if (flow) pair.flows.push(flow)
  if (seen) {
    // Two pairs of one suggestion that end on the same nodes (guests not drawn) are one line of the edge.
    const at = pair.observed.findIndex(o => o.id === seen.id)
    if (at < 0) pair.observed.push(seen)
    else pair.observed[at] = { ...pair.observed[at], hits: pair.observed[at].hits + seen.hits }
  }
  if (exception && !pair.exceptions.includes(exception)) pair.exceptions.push(exception)
  pairs.set(key, pair)
}

/** An end of an allowed flow: the box for a CIDR, the circle of a known zone, nothing for a zone that is gone. */
function allowedEnd(cidr: string, zoneId: string, box: string, known: ReadonlyMap<string, MicrosegZone>): string | null {
  if (cidr) return box
  return known.has(zoneId) ? zoneNodeId(zoneId) : null
}

/**
 * The allowed flows, circle to circle (a CIDR source from External, a CIDR destination to Outside). `address` may name
 * the node of a CIDR drawn on its own (the guest view draws a zone's gateway).
 */
export function addAllowedPairs(pairs: Map<string, Pair>, flows: MicrosegFlow[], known: ReadonlyMap<string, MicrosegZone>, address?: (cidr: string) => string | undefined) {
  for (const f of flows) {
    if (f.src_cidr && f.dst_cidr) continue
    const source = (f.src_cidr && address?.(f.src_cidr)) || allowedEnd(f.src_cidr, f.src_zone_id, EXTERNAL_ID, known)
    const target = (f.dst_cidr && address?.(f.dst_cidr)) || allowedEnd(f.dst_cidr, f.dst_zone_id, OUTSIDE_ID, known)
    if (!source || !target) continue
    // A flow to a CIDR is outbound, whether it ends on Outside or on a gateway drawn on its own.
    const toOutside = !!f.dst_cidr
    // A flow to Outside is solid once its source zone enforces the outbound traffic, dashed while it only observes it or not at all.
    const applied = toOutside && outboundFlowStatus(f, known.get(f.src_zone_id)) === 'applied'
    addPair(pairs, toOutside && !applied ? 'outside' : 'allowed', source, target, flowService(f), f)
  }
}

const OUTSIDE_RANK: Record<OutboundFlowStatus, number> = { applied: 0, observed: 1, notApplied: 2 }

/** What the Outside box says: the worst state among the flows to it (not applied, then observed, then applied); undefined with no flow to it. */
export function outsideEgressOf(flows: readonly MicrosegFlow[], known: ReadonlyMap<string, MicrosegZone>): OutboundFlowStatus | undefined {
  let worst: OutboundFlowStatus | undefined
  for (const f of flows) {
    if (!f.dst_cidr || f.src_cidr || !known.has(f.src_zone_id)) continue
    const status = outboundFlowStatus(f, known.get(f.src_zone_id))
    if (worst === undefined || OUTSIDE_RANK[status] > OUTSIDE_RANK[worst]) worst = status
  }
  return worst
}

/** The source of an observed flow: its guest (or its zone's circle), a guest in no zone, or External. */
function observedSource(s: MicrosegSuggestion, known: ReadonlyMap<string, MicrosegZone>, books: AddressBooks): string {
  const srcIp = bareIp(s.src_ip || '')
  if (known.has(s.src_zone_id)) return books.get(s.src_zone_id)!.get(srcIp) ?? zoneNodeId(s.src_zone_id)
  return books.get(UNZONED_ID)?.get(srcIp) ?? EXTERNAL_ID
}

/**
 * The observed flows as the map draws them, guest to guest: a suggestion counts every flow between two zones and holds
 * its hits by pair of addresses, so it is drawn once per pair, each with its own hits (and its id, for the panel). The
 * hits no pair holds (a row from before the pairs, or pairs past the ones kept) stay on its sample pair.
 */
export function byGuestPair(suggestions: readonly MicrosegSuggestion[]): MicrosegSuggestion[] {
  return suggestions.flatMap(s => {
    // Only what reads as a pair: a value of another shape draws the suggestion as before, on its sample pair.
    const pairs = (Array.isArray(s.pairs) ? s.pairs : [])
      .filter(p => !!p && typeof p.src_ip === 'string' && typeof p.dst_ip === 'string' && typeof p.hits === 'number' && p.hits > 0)
    if (pairs.length === 0) return [s]
    const rest = s.hits - pairs.reduce((sum, p) => sum + p.hits, 0)
    const sample = pairs.some(p => p.src_ip === s.src_ip && p.dst_ip === s.dst_ip)
    return [
      ...pairs.map(p => ({ ...s, src_ip: p.src_ip, dst_ip: p.dst_ip, hits: p.hits + (rest > 0 && sample && p.src_ip === s.src_ip && p.dst_ip === s.dst_ip ? rest : 0) })),
      ...(rest > 0 && !sample ? [{ ...s, hits: rest }] : []),
    ]
  })
}

/** The pending observed flows into a known zone, guest to guest. */
function addObservedPairs(pairs: Map<string, Pair>, suggestions: MicrosegSuggestion[], known: ReadonlyMap<string, MicrosegZone>, books: AddressBooks) {
  for (const s of suggestions) {
    if (s.status !== 'pending' || !known.has(s.dst_zone_id)) continue
    const kind: MapEdgeKind = s.kind === 'blocked' ? 'blocked' : 'unprotected'
    const source = observedSource(s, known, books)
    const target = books.get(s.dst_zone_id)!.get(bareIp(s.dst_ip || '')) ?? zoneNodeId(s.dst_zone_id)
    addPair(pairs, kind, source, target, flowService(s), undefined, s)
  }
}

/** Where each member of a group is drawn, by its key ("qemu/101"): its node, or the "+N" node when it is not drawn. */
export function memberBook(group: Group): Map<string, string> {
  const book = new Map<string, string>()
  const shownKeys = new Set(group.shown.map(m => m.key))
  const groupId = groupKey(group)
  for (const m of group.all) book.set(m.key, shownKeys.has(m.key) ? guestNodeId(groupId, m.key) : moreNodeId(groupId))
  return book
}

/**
 * One source and one destination of an exception that compiles to rules. `srcZone` is the zone of the source, or
 * UNZONED_ID for a running guest in no zone; `sourceKey` and `destinationKey` are their keys on the map (MapMember.key).
 */
export type ExceptionLink = {
  exception: MicrosegException; source: GuestRefLite; destination: GuestRefLite; srcZone: string; sourceKey: string; destinationKey: string
}

/**
 * The map key of a guest an exception names: on a shared policy the guests of an exception are those of its own cluster
 * (`connection_id`), so the same VMID on another cluster is not one of them.
 */
export const exceptionGuestKey = (exception: Pick<MicrosegException, 'connection_id'>, ref: GuestRefLite, shared: boolean) =>
  (shared ? guestId({ connectionId: exception.connection_id, type: ref.type, vmid: ref.vmid }) : guestKey(ref))

/**
 * What the exceptions allow, guest to guest, as the engine compiles them: nothing for a zone that is gone or neither
 * observed nor enforced, nothing to a destination that is no member of the zone. A source the map does not know (a
 * guest that is gone, a stopped guest in no zone) gives nothing either, and nothing is known while the members are not.
 */
export function exceptionLinks(
  exceptions: MapInput['exceptions'], known: ReadonlyMap<string, MicrosegZone>, members: MapInput['members'], unzoned: MapInput['unzoned'],
  shared = false,
): ExceptionLink[] {
  if (!exceptions?.length || !members) return []
  const zoneOf = new Map<string, string>()
  for (const m of unzoned ?? []) zoneOf.set(m.key, UNZONED_ID)
  // A guest two zones hold (a change of zone that is queued) is of the first by name, on every rendering.
  for (const id of [...known.keys()].reverse()) for (const m of members.get(id) ?? []) zoneOf.set(m.key, id)
  const links: ExceptionLink[] = []
  for (const exception of [...exceptions].sort((a, b) => byText(a.id, b.id))) {
    const state = known.get(exception.zone_id)?.state
    if (state !== 'observe' && state !== 'enforce') continue
    const inZone = new Set((members.get(exception.zone_id) ?? []).map(m => m.key))
    for (const destination of exception.destinations) {
      const destinationKey = exceptionGuestKey(exception, destination, shared)
      if (!inZone.has(destinationKey)) continue
      for (const source of exception.sources) {
        const sourceKey = exceptionGuestKey(exception, source, shared)
        const srcZone = zoneOf.get(sourceKey)
        if (srcZone) links.push({ exception, source, destination, srcZone, sourceKey, destinationKey })
      }
    }
  }
  return links
}

/**
 * The exceptions from a zone to another, on the zone renderings: each one is counted on the allowed link between the
 * two zones, or on a dashed link of their own when no flow links them. An exception inside its zone, or from a guest
 * in no zone, draws no link.
 */
export function addExceptionZonePairs(pairs: Map<string, Pair>, links: readonly ExceptionLink[]) {
  for (const { exception, srcZone } of links) {
    if (srcZone === UNZONED_ID || srcZone === exception.zone_id) continue
    const ends = { source: zoneNodeId(srcZone), target: zoneNodeId(exception.zone_id) }
    const key = pairs.has(pairKey({ kind: 'allowed', ...ends })) ? pairKey({ kind: 'allowed', ...ends }) : pairKey({ kind: 'exception', ...ends })
    const pair = pairs.get(key) ?? { kind: 'exception' as const, ...ends, services: new Set<string>(), flows: [], observed: [], exceptions: [] }
    if (!pair.exceptions.includes(exception)) pair.exceptions.push(exception)
    pairs.set(key, pair)
  }
}

export const comparePairs = (a: Pair, b: Pair) => KIND_RANK[a.kind] - KIND_RANK[b.kind] || byText(a.source, b.source) || byText(a.target, b.target)

const circleCell = (group: Group): Cell => ({ id: group.id, w: 2 * group.radius, h: 2 * group.radius })

/** Column 0 holds External and the guests in no zone, the zone columns follow, Outside is last. */
function buildGrid(columns: string[][], groups: Map<string, Group>, hasExternal: boolean, hasOutside: boolean): Cell[][] {
  const grid: Cell[][] = []
  const first: Cell[] = []
  if (hasExternal) first.push({ id: EXTERNAL_ID, w: NODE_W, h: NODE_H })
  const unzonedGroup = groups.get(UNZONED_ID)
  if (unzonedGroup) first.push(circleCell(unzonedGroup))
  if (first.length) grid.push(first)
  for (const column of columns.slice(1)) {
    if (column.length) grid.push(column.map(id => circleCell(groups.get(zoneNodeId(id))!)))
  }
  if (hasOutside) grid.push([{ id: OUTSIDE_ID, w: NODE_W, h: NODE_H }])
  return grid
}

/** The center of every cell: the columns side by side (`colGap` apart), each centered on y = 0. */
export function cellCenters(grid: Cell[][], colGap = COL_GAP, rowGap = ROW_GAP): Map<string, Point> {
  const centers = new Map<string, Point>()
  let left = 0
  for (const column of grid) {
    const width = Math.max(...column.map(c => c.w))
    const height = column.reduce((s, c) => s + c.h, 0) + rowGap * (column.length - 1)
    let top = -height / 2
    for (const c of column) {
      centers.set(c.id, { x: Math.round(left + width / 2), y: Math.round(top + c.h / 2) })
      top += c.h + rowGap
    }
    left += width + colGap
  }
  return centers
}

export function placeBoundary(out: Placement, id: string, c: Point, egress?: OutboundFlowStatus) {
  out.nodes.push({
    id, type: 'boundary', position: { x: c.x - NODE_W / 2, y: c.y - NODE_H / 2 }, width: NODE_W, height: NODE_H, focusable: false,
    data: { kind: id === EXTERNAL_ID ? 'external' : 'outside', ...(id === OUTSIDE_ID && egress ? { egress } : {}) } satisfies BoundaryNodeData,
  })
  out.obstacles.push({ id, center: c, shape: BOX_SHAPE })
  out.endShapes.set(id, { center: c, shape: BOX_SHAPE, group: id })
}

/** Where the guests of a circle go when it is not its grid: the center of each glyph from the center of the circle, and their width. */
export type GuestPlaces = { centers: Point[]; width: number }

/**
 * A circle, then its guests and its "+N" node (React Flow wants a parent before its children). The guests fill the
 * grid of the circle, or the `places` given (an entered zone spreads them on rings).
 */
export function placeGroup(out: Placement, group: Group, c: Point, places?: GuestPlaces) {
  const r = group.radius
  const origin = { x: c.x - r, y: c.y - r }
  out.nodes.push({ id: group.id, type: group.data.kind, position: origin, width: 2 * r, height: 2 * r, focusable: false, data: group.data })
  out.obstacles.push({ id: group.id, center: c, shape: { kind: 'circle', r } })
  out.endShapes.set(group.id, { center: c, shape: { kind: 'circle', r }, group: group.id })
  const groupId = groupKey(group)
  const grid = places ? null : slotPositions(group.shown.length + (group.more ? 1 : 0), r)
  const child = (id: string, i: number, data: GuestNodeData | MoreNodeData) => {
    const width = data.kind === 'guest' && data.width ? data.width : GUEST_W
    const spot = grid ? grid[i] : { x: r + places!.centers[i].x - width / 2, y: r + places!.centers[i].y - GLYPH_Y }
    out.nodes.push({ id, type: data.kind, parentId: group.id, position: spot, width, height: GUEST_H, focusable: false, data })
    out.endShapes.set(id, { center: { x: origin.x + spot.x + width / 2, y: origin.y + spot.y + GLYPH_Y }, shape: { kind: 'circle', r: GUEST_R }, group: group.id })
  }
  group.shown.forEach((m, i) => child(guestNodeId(groupId, m.key), i, { kind: 'guest', member: m, groupId, ...(places ? { width: places.width } : {}) }))
  if (group.more) child(moreNodeId(groupId), group.shown.length, { kind: 'more', count: group.more, groupId })
}

/** The nodes in grid order, with the obstacles the edges avoid and the outline every edge end clips on. */
function buildNodes(grid: Cell[][], centers: Map<string, Point>, groups: Map<string, Group>, outsideEgress?: OutboundFlowStatus): Placement {
  const out: Placement = { nodes: [], obstacles: [], endShapes: new Map() }
  for (const cell of grid.flat()) {
    const c = centers.get(cell.id)!
    const group = groups.get(cell.id)
    if (group) placeGroup(out, group, c)
    else placeBoundary(out, cell.id, c, outsideEgress)
  }
  return out
}

/** Unprotected, Outside and exception edges are dashed, a draft-only edge dotted, the others solid. */
function edgeDash(kind: MapEdgeKind, draft: boolean): string | undefined {
  if (kind === 'unprotected' || kind === 'outside' || kind === 'exception') return '6 4'
  return draft ? '1 5' : undefined
}

function dashStyle(dash: string | undefined, draft: boolean): Pick<CSSProperties, 'strokeDasharray' | 'strokeLinecap'> {
  if (!dash) return {}
  return { strokeDasharray: dash, strokeLinecap: draft ? 'round' : undefined }
}

/** The log occurrences of an observed edge, summed; null on an allowed one. */
export function edgeHits(p: Pick<Pair, 'kind' | 'observed'>): number | null {
  return isObserved(p.kind) ? p.observed.reduce((sum, s) => sum + (s.hits ?? 0), 0) : null
}

/**
 * The occurrences as the label shows them, to size the label before the page formats them (`compact` notation: "158",
 * "1.4K"): the same length, whatever the language.
 */
export function shortHits(hits: number): string {
  if (hits < 1000) return String(hits)
  if (hits < 1_000_000) return `${(hits / 1000).toFixed(hits < 10_000 ? 1 : 0)}K`
  return `${(hits / 1_000_000).toFixed(1)}M`
}

/** An exception of the guest view, drawn from guest to guest with its services (a link between two zones that only stands for exceptions has none). */
const isGuestException = (p: Pair) => p.kind === 'exception' && p.services.size > 0

/** An edge between two guests has the smaller label: an observed one, or an exception of the guest view. */
const isGuestEdge = (p: Pair) => isObserved(p.kind) || isGuestException(p)

/** The exceptions the label of an edge counts: those of a link between two zones. */
const exceptionCount = (p: Pair) => (isGuestException(p) ? 0 : p.exceptions.length)

/**
 * The text an edge label is sized for: its services, the occurrences of an observed edge, and the count of the
 * exceptions between two zones ("2 exceptions": the word has this length, or about, in the languages served).
 */
function labelText(p: Pair): string {
  const hits = edgeHits(p)
  const count = exceptionCount(p)
  return [
    p.services.size ? groupServices([...p.services]) : null,
    hits === null ? null : shortHits(hits),
    count ? `${count} exception${count > 1 ? 's' : ''}` : null,
  ].filter(part => part !== null).join(' · ')
}

function toEdge(p: Pair, place: PlacedEdge, endShapes: Map<string, EdgeEnds>, unapplied: ReadonlySet<string> | null): Edge {
  const observed = isObserved(p.kind)
  const draft = !!unapplied && p.flows.length > 0 && p.flows.every(f => unapplied.has(f.id))
  const color = EDGE_COLORS[p.kind]
  return {
    id: pairKey(p),
    type: 'flow',
    source: p.source,
    target: p.target,
    // The map is read with the pointer or with the zone buttons: the edges take no focus (the panels list the flows).
    focusable: false,
    zIndex: observed ? 2 : 1,
    style: { stroke: color, strokeWidth: observed ? 1.75 : 2, ...dashStyle(edgeDash(p.kind, draft), draft) },
    markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
    data: {
      kind: p.kind,
      services: [...p.services].sort(byText),
      label: groupServices([...p.services]),
      count: observed ? p.observed.length : p.flows.length,
      hits: edgeHits(p),
      flows: [...p.flows].sort((a, b) => byText(a.id, b.id)),
      observed: [...p.observed].sort((a, b) => byText(a.id, b.id)),
      exceptions: [...p.exceptions].sort((a, b) => byText(a.id, b.id)),
      exceptionCount: exceptionCount(p),
      draft,
      fromGroup: endShapes.get(p.source)!.group,
      toGroup: endShapes.get(p.target)!.group,
      path: place.path,
      points: place.points,
      label_x: place.label.x,
      label_y: place.label.y,
      label_w: place.label.w,
      label_h: place.label.h,
      small: isGuestEdge(p),
      particle: p.kind === 'allowed' && !draft,
      color,
    } satisfies MapEdgeData,
  }
}

/**
 * The map: a circle per zone holding its guests (11 and a "+N" past 12), a dashed circle of the running guests in
 * no zone, an "Unknown / External" box for the sources in no zone and an Outside box for the CIDR destinations.
 * Allowed flows go circle to circle, one green edge per ordered pair, which also counts the exceptions between the two
 * zones (a dashed link of their own without a flow); observed flows (unprotected, blocked) go guest
 * to guest, resolved from their addresses (the circle when the address is no drawn guest's). Circles on a grid:
 * longest-path layer as the column, barycenter order as the row. Pure and deterministic.
 */
export function buildZoneGraph({ zones, flows, suggestions, members = null, unzoned = null, unapplied = null, exceptions = null, clusters = null }: MapInput): ZoneGraph {
  const { sorted, known, columns } = zoneColumns(zones, flows)
  const { groups, books } = buildGroups(sorted, members, unzoned)

  // Edges, by their ends.
  const pairs = new Map<string, Pair>()
  addAllowedPairs(pairs, flows, known)
  addExceptionZonePairs(pairs, exceptionLinks(exceptions, known, members, unzoned, isSharedMap({ clusters })))
  addObservedPairs(pairs, byGuestPair(suggestions), known, books)
  const ordered = [...pairs.values()].sort(comparePairs)

  // Grid: longest-path layer as the column, barycenter order as the row; the columns of a map too tall to read are folded.
  const grid = foldColumns(buildGrid(columns, groups, ordered.some(p => p.source === EXTERNAL_ID), ordered.some(p => p.target === OUTSIDE_ID)), COL_GAP, ROW_GAP)
  const { nodes, obstacles, endShapes } = buildNodes(grid, cellCenters(grid), groups, outsideEgressOf(flows, known))
  return { nodes, edges: placePairs(ordered, endShapes, obstacles, unapplied) }
}

/**
 * The zones in name order, by id, and their columns on the map: the longest-path layer of the flows between zones
 * (a zone External sends to is a front door), then the barycenter order in each column.
 */
export function zoneColumns(zones: MicrosegZone[], flows: MicrosegFlow[]): { sorted: MicrosegZone[]; known: Map<string, MicrosegZone>; columns: string[][] } {
  const sorted = [...zones].sort((a, b) => byText(a.name, b.name) || byText(a.id, b.id))
  const known = new Map(sorted.map(z => [z.id, z]))
  const layerEdges = flows
    .filter(f => !f.src_cidr && !f.dst_cidr && known.has(f.src_zone_id) && known.has(f.dst_zone_id))
    .map(f => [f.src_zone_id, f.dst_zone_id] as [string, string])
  const fromExternal = flows.filter(f => f.src_cidr && known.has(f.dst_zone_id) && !f.dst_cidr).map(f => f.dst_zone_id)
  const layer = layerZones(sorted.map(z => z.id), layerEdges, fromExternal)
  return { sorted, known, columns: orderLayers(layer, layerEdges, id => known.get(id)!.name) }
}

/** The edges of the pairs, in their order, each placed (lanes, bows, label) between the outlines of its ends. */
export function placePairs(ordered: Pair[], endShapes: Map<string, EdgeEnds>, obstacles: Obstacle[], unapplied: ReadonlySet<string> | null): Edge[] {
  const placed = placeEdges(
    ordered.map(p => ({ id: pairKey(p), source: p.source, target: p.target, label: labelText(p), small: isGuestEdge(p) })),
    endShapes,
    obstacles,
  )
  return ordered.flatMap(p => {
    const place = placed.get(pairKey(p))
    return place ? [toEdge(p, place, endShapes, unapplied)] : []
  })
}

export type FlowFilters = { allowed: boolean; unprotected: boolean; blocked: boolean }
export const ALL_FLOWS: FlowFilters = { allowed: true, unprotected: true, blocked: true }
/** The checkbox of the toolbar each kind of edge follows. */
const FILTER_OF_KIND: Record<MapEdgeKind, keyof FlowFilters> = { allowed: 'allowed', exception: 'allowed', outside: 'allowed', unprotected: 'unprotected', blocked: 'blocked' }

/** How far back the observed flows of the map go: seen within the last hour, day or week, or whenever. */
export const SEEN_PERIODS = ['1h', '24h', '7d', 'all'] as const
export type SeenPeriod = (typeof SEEN_PERIODS)[number]
const SEEN_MS: Record<Exclude<SeenPeriod, 'all'>, number> = { '1h': 3_600_000, '24h': 86_400_000, '7d': 604_800_000 }

/** An observed flow not seen for this long is drawn faded: its hits are a total since it was first seen, not now. */
export const STALE_AFTER_MS = 3_600_000

/** An edge with only some of its observed flows: their services, their hits, and the flows of those services. */
function withObserved(e: Edge, d: MapEdgeData, observed: MicrosegSuggestion[]): Edge {
  const kept = new Set(observed.map(o => flowService(o)))
  const services = d.services.filter(s => kept.has(s))
  const data: MapEdgeData = { ...d, services, label: groupServices(services), observed, count: observed.length, hits: observed.reduce((sum, o) => sum + (o.hits ?? 0), 0) }
  return { ...e, data: data as unknown as Edge['data'] }
}

/** When the observed flows of an edge were last seen (the latest of them), null for an edge with none or no date. */
export function lastSeenOf(d: Pick<MapEdgeData, 'observed'>): number | null {
  const times = d.observed.map(o => Date.parse(o.last_seen)).filter(t => Number.isFinite(t))
  return times.length > 0 ? Math.max(...times) : null
}

/**
 * The edges left when only the observed flows seen within `period` are drawn: an observed edge keeps the flows seen
 * since then (one with none goes), with their services and their hits; the hits stay the total of each flow since it
 * was first seen. A flow with no readable date is kept. The allowed flows and the exceptions have no date: kept.
 */
export function filterEdgeAge(edges: Edge[], period: SeenPeriod, now: number): Edge[] {
  if (period === 'all') return edges
  const since = now - SEEN_MS[period]
  return edges.flatMap(e => {
    const d = e.data as unknown as MapEdgeData
    if (d.hits === null) return [e]
    const observed = d.observed.filter(o => {
      const at = Date.parse(o.last_seen)
      return !Number.isFinite(at) || at >= since
    })
    if (observed.length === 0) return []
    return observed.length === d.observed.length ? [e] : [withObserved(e, d, observed)]
  })
}

/** A service the edges of a map carry: its token ("tcp/22", "icmp") and how it reads ("SSH"). */
export type EdgeService = { token: string; label: string }

/** The services the edges carry, each once, by the way they read. */
export function edgeServices(edges: readonly Edge[]): EdgeService[] {
  const tokens = new Set(edges.flatMap(e => (e.data as unknown as MapEdgeData).services ?? []))
  const named = [...tokens].map(token => ({ token, label: groupServices([token]) }))
  // Two ports that read the same ("HTTP-alt" for 8008 and 8080) say their port.
  const count = new Map<string, number>()
  for (const s of named) count.set(s.label, (count.get(s.label) ?? 0) + 1)
  // Read as a list: by name whatever the case ("icmp" between "HTTPS" and "PostgreSQL").
  return named.map(s => (count.get(s.label)! > 1 && s.label !== s.token ? { token: s.token, label: `${s.label} (${s.token})` } : s)).sort((a, b) => a.label.localeCompare(b.label, 'en', { sensitivity: 'base' }) || byText(a.token, b.token))
}

/**
 * The edges left when only the services `shown` are drawn (null: all of them): an edge none of whose services is shown
 * goes, and one that keeps some carries only those, with their flows, their observed flows and their hits. An edge
 * with no service at all (a link that only stands for exceptions between two zones) is not a matter of services: kept.
 */
export function filterEdgeServices(edges: Edge[], shown: ReadonlySet<string> | null): Edge[] {
  if (!shown) return edges
  return edges.flatMap(e => {
    const d = e.data as unknown as MapEdgeData
    if (d.services.length === 0) return [e]
    const services = d.services.filter(s => shown.has(s))
    if (services.length === 0) return []
    if (services.length === d.services.length) return [e]
    if (d.hits !== null) return [withObserved(e, d, d.observed.filter(o => shown.has(flowService(o))))]
    const flows = d.flows.filter(f => shown.has(flowService(f)))
    const data: MapEdgeData = { ...d, services, label: groupServices(services), flows, count: flows.length }
    return [{ ...e, data: data as unknown as Edge['data'] }]
  })
}

/** The edges the three checkboxes of the toolbar let through (the flows to Outside and the exceptions are allowed flows). */
export function filterEdges(edges: Edge[], filters: FlowFilters): Edge[] {
  return edges.filter(e => filters[FILTER_OF_KIND[(e.data as unknown as MapEdgeData).kind] ?? 'allowed'])
}

/**
 * What stays lit when a node or an edge has the focus: for a circle its guests, its edges and their other ends;
 * for a guest (or a box) its own edges and their ends; for an edge its two ends. The circle of a lit guest stays lit.
 * Null when nothing has the focus (or the id is unknown).
 */
export function focusSets(graph: ZoneGraph, id: string | null): { nodes: Set<string>; edges: Set<string> } | null {
  if (!id) return null
  const parent = new Map(graph.nodes.map(n => [n.id, n.parentId]))
  const lit = new Set<string>()
  const edges = new Set<string>()
  const light = (nodeId: string) => {
    lit.add(nodeId)
    const p = parent.get(nodeId)
    if (p) lit.add(p)
  }
  const edge = graph.edges.find(e => e.id === id)
  if (edge) {
    edges.add(edge.id)
    light(edge.source)
    light(edge.target)
    return { nodes: lit, edges }
  }
  if (!parent.has(id)) return null
  const own = new Set([id, ...graph.nodes.filter(n => n.parentId === id).map(n => n.id)])
  own.forEach(light)
  for (const e of graph.edges) {
    if (own.has(e.source) || own.has(e.target)) {
      edges.add(e.id)
      light(e.source)
      light(e.target)
    }
  }
  return { nodes: lit, edges }
}
