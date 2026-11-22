import { networkOf, type NamedNetwork } from '@/lib/microseg/namedNetworks'
import type { MicrosegFlow, MicrosegSuggestion, MicrosegZone } from '@/lib/microseg/types'

import { BOX_H, BOX_W, placeBox } from './compactGraph'
import { flowService } from './FlowSummary'
import { gatewayZones } from './gatewayNames'
import type { Point } from './edgeGeometry'
import {
  BOX_SHAPE, EXTERNAL_ID, NODE_H, NODE_W, OUTSIDE_ID, UNZONED_ID, addAllowedPairs, addPair, addressBook, bareIp, byGuestPair, cellCenters,
  comparePairs, exceptionLinks, groupOf, isSharedMap, memberBook, outsideEgressOf, placeBoundary, placeGroup, placePairs, zoneNodeId,
  type AddressBooks, type Cell, type ExceptionLink, type Group, type IpNodeData, type MapEdgeKind, type MapInput, type MapMember, type Pair,
  type Placement, type ZoneGraph, type ZoneNodeData,
} from './zoneGraph'
import { INSIDE_GUEST_W, INSIDE_MAX_SHOWN, byText, insideSlots, ringLayout } from './zoneLayout'

/** The addresses in no zone drawn on their own (the busiest first); the others go to Unknown / External. */
export const MAX_IPS = 8

export const ipNodeId = (ip: string) => `ip:${ip}`

/** A peer zone with no guest drawn is a small circle; a side taller than MAX_PER_COLUMN nodes is split in columns. */
export const EMPTY_PEER_R = 70
export const MAX_PER_COLUMN = 3
/** Around an entered zone the peers are boxes: more of them fit in a column. */
export const MAX_BOXES_PER_COLUMN = 6
/** Around an entered zone the columns are closer (boxes, not circles): the zone is drawn larger in the same view. */
export const INSIDE_COL_GAP = 170
export const INSIDE_ROW_GAP = 60

export type GuestViewInput = MapInput & {
  centre: string
  /**
   * False: the addresses in no zone are not drawn one by one, they all go to the Unknown / External box (a zone open
   * to many addresses is unreadable otherwise). The gateway of a zone and the named networks are still drawn.
   * Absent: drawn.
   */
  externalAddresses?: boolean
}

const pending = (suggestions: MicrosegSuggestion[], known: ReadonlyMap<string, MicrosegZone>) =>
  suggestions.filter(s => s.status === 'pending' && known.has(s.dst_zone_id))

/** The pending hits of every zone, as a source and as a destination (0 for a zone nothing was seen on). */
export function zoneTraffic(zones: MicrosegZone[], suggestions: MicrosegSuggestion[]): Map<string, number> {
  const known = new Map(zones.map(z => [z.id, z]))
  const traffic = new Map(zones.map(z => [z.id, 0]))
  for (const s of pending(suggestions, known)) {
    traffic.set(s.dst_zone_id, traffic.get(s.dst_zone_id)! + s.hits)
    if (known.has(s.src_zone_id) && s.src_zone_id !== s.dst_zone_id) traffic.set(s.src_zone_id, traffic.get(s.src_zone_id)! + s.hits)
  }
  return traffic
}

/** The zone the view opens on: the one with the most observed traffic, ties (and no traffic at all) by name. */
export function defaultCentre(zones: MicrosegZone[], suggestions: MicrosegSuggestion[]): string | null {
  const traffic = zoneTraffic(zones, suggestions)
  const sorted = [...zones].sort((a, b) => traffic.get(b.id)! - traffic.get(a.id)! || byText(a.name, b.name) || byText(a.id, b.id))
  return sorted[0]?.id ?? null
}

type Around = {
  centre: MicrosegZone
  known: Map<string, MicrosegZone>
  flows: MicrosegFlow[]
  seen: MicrosegSuggestion[]
  /** What the exceptions allow to a member of the centre, or from one to a member of another zone. */
  links: ExceptionLink[]
  /** The guests those exceptions name in each zone but the centre (see namedGuests). */
  named: Map<string, Set<string>>
}

/** The guests (map keys) the exceptions name in each zone but the centre (and under UNZONED_ID): drawn like the ones that talked to it. */
function namedGuests(centre: MicrosegZone, links: readonly ExceptionLink[]): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  const add = (zoneId: string, key: string) => {
    if (zoneId !== centre.id) out.set(zoneId, (out.get(zoneId) ?? new Set()).add(key))
  }
  for (const l of links) {
    add(l.srcZone, l.sourceKey)
    add(l.exception.zone_id, l.destinationKey)
  }
  return out
}

/** The addresses each peer zone talked to the centre from (or was reached on). */
function involvedAddresses({ centre, known, seen }: Around): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>()
  const add = (zoneId: string, ip: string) => {
    if (!known.has(zoneId) || zoneId === centre.id || !ip) return
    out.set(zoneId, (out.get(zoneId) ?? new Set()).add(bareIp(ip)))
  }
  for (const s of seen) {
    add(s.src_zone_id, s.src_ip)
    add(s.dst_zone_id, s.dst_ip)
  }
  return out
}

/** The zones that talk to the centre (left) and the ones only the centre talks to (right), by name. */
function peerSides({ centre, known, flows, seen, links }: Around): { left: string[]; right: string[] } {
  const sources = new Set<string>()
  const peers = new Set<string>()
  const meet = (src: string, dst: string) => {
    for (const id of [src, dst]) if (known.has(id) && id !== centre.id) peers.add(id)
    if (dst === centre.id && known.has(src) && src !== centre.id) sources.add(src)
  }
  for (const f of flows) meet(f.src_zone_id, f.dst_zone_id)
  for (const s of seen) meet(s.src_zone_id, s.dst_zone_id)
  for (const l of links) meet(l.srcZone, l.exception.zone_id)
  const byName = (a: string, b: string) => byText(known.get(a)!.name, known.get(b)!.name) || byText(a, b)
  const all = [...peers].sort(byName)
  return { left: all.filter(id => sources.has(id)), right: all.filter(id => !sources.has(id)) }
}

const hasAddress = (m: MapMember, ips: ReadonlySet<string> | undefined) => !!ips && m.ips.some(ip => ips.has(bareIp(ip)))

/** The addresses of the centre that were seen talking (or talked to), and its guests an exception names. */
function busyInCentre({ centre, seen, links }: Around): (m: MapMember) => boolean {
  const ips = new Set<string>()
  for (const s of seen) {
    if (s.src_zone_id === centre.id && s.src_ip) ips.add(bareIp(s.src_ip))
    if (s.dst_zone_id === centre.id && s.dst_ip) ips.add(bareIp(s.dst_ip))
  }
  const keys = new Set<string>()
  for (const l of links) {
    if (l.srcZone === centre.id) keys.add(l.sourceKey)
    if (l.exception.zone_id === centre.id) keys.add(l.destinationKey)
  }
  return m => keys.has(m.key) || hasAddress(m, ips)
}

/**
 * The circle of an entered zone: its guests on rings, up to INSIDE_MAX_SHOWN of them and a "+N" node past it. In a
 * zone too large to be drawn whole, the guests with a flow or an exception come first.
 */
function insideGroup(around: Around, all: MapMember[] | null): Group {
  const zone = around.centre
  const list = [...(all ?? [])].sort((a, b) => byText(a.name, b.name) || byText(a.key, b.key))
  if (list.length > INSIDE_MAX_SHOWN) {
    const busy = busyInCentre(around)
    const rank = new Map(list.map((m, i) => [m.key, (busy(m) ? 0 : list.length) + i]))
    list.sort((a, b) => rank.get(a.key)! - rank.get(b.key)!)
  }
  const { shown, more } = insideSlots(list.length)
  const radius = ringLayout(shown + (more ? 1 : 0)).radius
  const data: ZoneNodeData = { kind: 'zone', zone, members: all ? all.length : null, state: zone.state, radius, entered: true }
  return { id: zoneNodeId(zone.id), radius, all: list, shown: list.slice(0, shown), more, data }
}

/**
 * The circles: the centre with every member, each peer with only the members that talked to the centre or that an
 * exception links to it. Around an entered zone (`inside`) the centre spreads its guests on rings and a peer has no
 * circle: it is a box, every flow with it ends on the box.
 */
function buildCircles(around: Around, members: MapInput['members'], peers: string[], inside: boolean): { groups: Map<string, Group>; books: AddressBooks } {
  const groups = new Map<string, Group>()
  const books: AddressBooks = new Map()
  const involved = involvedAddresses(around)
  const { named } = around
  for (const id of [around.centre.id, ...peers]) {
    const z = around.known.get(id)!
    const all = members ? (members.get(id) ?? []) : null
    if (inside) {
      if (id === around.centre.id) {
        const g = insideGroup(around, all)
        groups.set(g.id, g)
        books.set(id, addressBook(g))
      } else {
        books.set(id, new Map())
      }
      continue
    }
    const drawn = all && id !== around.centre.id ? all.filter(m => hasAddress(m, involved.get(id)) || !!named.get(id)?.has(m.key)) : all
    const g = groupOf(zoneNodeId(id), drawn, { kind: 'zone', zone: z, members: all ? all.length : null, state: z.state, radius: 0 })
    if (id !== around.centre.id && g.shown.length === 0) {
      g.radius = EMPTY_PEER_R
      g.data.radius = EMPTY_PEER_R
    }
    groups.set(g.id, g)
    books.set(id, addressBook(g))
  }
  return { groups, books }
}

/** The guests in no zone that talked to the centre, or that an exception lets reach it, in their own circle. */
function addUnzoned(groups: Map<string, Group>, books: AddressBooks, around: Around, unzoned: MapInput['unzoned']) {
  if (!unzoned?.length) return
  const { seen, known } = around
  const sources = new Set(seen.filter(s => !known.has(s.src_zone_id) && s.src_ip).map(s => bareIp(s.src_ip)))
  const named = around.named.get(UNZONED_ID)
  const drawn = unzoned.filter(m => hasAddress(m, sources) || !!named?.has(m.key))
  if (!drawn.length) return
  const g = groupOf(UNZONED_ID, drawn, { kind: 'unzoned', count: drawn.length, radius: 0 })
  groups.set(UNZONED_ID, g)
  books.set(UNZONED_ID, addressBook(g))
}

/** A box that stands for a named network: its key is the CIDR of the network. */
const isNetworkBox = (key: string) => key.includes('/')

/** The busiest addresses in no zone and no guest that talked to the centre (a named network is one), at most MAX_IPS. */
function ownAddresses(seen: MicrosegSuggestion[], known: ReadonlyMap<string, MicrosegZone>, books: AddressBooks, gateways: ReadonlySet<string>, boxOf: (ip: string) => string): string[] {
  const hits = new Map<string, number>()
  for (const s of seen) {
    const ip = bareIp(s.src_ip || '')
    if (known.has(s.src_zone_id) || !ip || books.get(UNZONED_ID)?.has(ip)) continue
    const box = boxOf(ip)
    hits.set(box, (hits.get(box) ?? 0) + s.hits)
  }
  // A gateway, then a named network, are drawn before the other addresses, whatever their traffic: they are named.
  const rank = (ip: string) => {
    if (gateways.has(ip)) return 0
    return isNetworkBox(ip) ? 1 : 2
  }
  return [...hits].sort((a, b) => rank(a[0]) - rank(b[0]) || b[1] - a[1] || byText(a[0], b[0])).slice(0, MAX_IPS).map(([ip]) => ip)
}

function observedPairs(pairs: Map<string, Pair>, seen: MicrosegSuggestion[], known: ReadonlyMap<string, MicrosegZone>, books: AddressBooks, ips: ReadonlySet<string>, boxOf: (ip: string) => string) {
  for (const s of seen) {
    const kind: MapEdgeKind = s.kind === 'blocked' ? 'blocked' : 'unprotected'
    const srcIp = bareIp(s.src_ip || '')
    let source: string
    if (known.has(s.src_zone_id)) source = books.get(s.src_zone_id)!.get(srcIp) ?? zoneNodeId(s.src_zone_id)
    else source = books.get(UNZONED_ID)?.get(srcIp) ?? (srcIp && ips.has(boxOf(srcIp)) ? ipNodeId(boxOf(srcIp)) : EXTERNAL_ID)
    const target = books.get(s.dst_zone_id)!.get(bareIp(s.dst_ip || '')) ?? zoneNodeId(s.dst_zone_id)
    addPair(pairs, kind, source, target, flowService(s), undefined, s)
  }
}

/**
 * The exceptions, guest to guest: one dashed edge per source and destination with the services of the exceptions of
 * the pair, each end on its guest (the "+N" node of its circle when it is not drawn).
 */
function exceptionPairs(pairs: Map<string, Pair>, links: readonly ExceptionLink[], groups: ReadonlyMap<string, Group>, boxes: ReadonlySet<string>) {
  const books = new Map([...groups].map(([id, g]) => [id, memberBook(g)]))
  const nodeOf = (zoneId: string, key: string) => {
    const groupId = zoneId === UNZONED_ID ? UNZONED_ID : zoneNodeId(zoneId)
    return books.get(groupId)?.get(key) ?? (groups.has(groupId) || boxes.has(groupId) ? groupId : null)
  }
  for (const l of links) {
    const source = nodeOf(l.srcZone, l.sourceKey)
    const target = nodeOf(l.exception.zone_id, l.destinationKey)
    if (!source || !target) continue
    for (const service of l.exception.services) addPair(pairs, 'exception', source, target, flowService(service), undefined, undefined, l.exception)
  }
}

function placeIp(out: Placement, ip: string, c: Point, zones: readonly MicrosegZone[], networks: readonly NamedNetwork[]) {
  const id = ipNodeId(ip)
  const gatewayOf = gatewayZones(zones, ip)
  const network = isNetworkBox(ip) ? networks.find(n => n.cidr === ip)?.name : undefined
  const data: IpNodeData = { kind: 'ip', ip, ...(gatewayOf.length ? { gatewayOf } : {}), ...(network ? { network } : {}) }
  out.nodes.push({ id, type: 'ip', position: { x: c.x - NODE_W / 2, y: c.y - NODE_H / 2 }, width: NODE_W, height: NODE_H, focusable: false, data })
  out.obstacles.push({ id, center: c, shape: BOX_SHAPE })
  out.endShapes.set(id, { center: c, shape: BOX_SHAPE, group: id })
}

/** A side in columns of `per` nodes at most, the first column nearest the centre. */
function columnsOf(side: Cell[], per: number): Cell[][] {
  const columns: Cell[][] = []
  for (let i = 0; i < side.length; i += per) columns.push(side.slice(i, i + per))
  return columns
}

const box = (id: string): Cell => ({ id, w: NODE_W, h: NODE_H })
const circle = (g: Group): Cell => ({ id: g.id, w: 2 * g.radius, h: 2 * g.radius })

/**
 * The guest view, for an investigation: one zone in the centre with its guests (11 and a "+N" past 12). On its left
 * what talks to it (Unknown / External, the busiest addresses in no zone, the guests in no zone, the zones that send
 * to it), on its right what only it talks to (zones, Outside). The peers hold only the guests that talked to the
 * centre. Observed flows go guest to guest (one sample pair per observed flow, see UA28), allowed flows circle to
 * circle, and an exception from its source guest to its destination guest, dashed (its source drawn in its zone as if
 * it had talked to the centre); nothing is drawn between two peers. Pure and deterministic.
 */
export function buildGuestView(input: GuestViewInput): ZoneGraph {
  return buildAround(input, false)
}

/**
 * Inside a zone (a double click on it enters it): the zone alone as one large circle, every guest of it on rings
 * with its full name (INSIDE_MAX_SHOWN and a "+N" past it), so that what its guests exchange with each other reads as
 * chords of the circle. The rest of the map is folded around it: a box per zone that talks to it (left) or that only it
 * talks to (right), with Unknown / External, the busiest addresses, the guests in no zone and Outside as on the guest
 * view. Every flow with another zone goes from the guest of the zone to the box of the other. Pure and deterministic.
 */
export function buildZoneInside(input: GuestViewInput): ZoneGraph {
  return buildAround(input, true)
}

function buildAround({ zones, flows, suggestions, members = null, unzoned = null, unapplied = null, exceptions = null, clusters = null, networks = null, centre, externalAddresses = true, gauges = false }: GuestViewInput, inside: boolean): ZoneGraph {
  const sorted = [...zones].sort((a, b) => byText(a.name, b.name) || byText(a.id, b.id))
  const known = new Map(sorted.map(z => [z.id, z]))
  const zone = known.get(centre)
  if (!zone) return { nodes: [], edges: [] }
  const touches = (src: string, dst: string) => src === centre || dst === centre
  const links = exceptionLinks(exceptions, known, members, unzoned, isSharedMap({ clusters })).filter(l => touches(l.srcZone, l.exception.zone_id))
  const around: Around = {
    centre: zone,
    known,
    flows: flows.filter(f => touches(f.src_zone_id, f.dst_zone_id)).sort((a, b) => byText(a.id, b.id)),
    seen: byGuestPair(pending(suggestions, known).filter(s => touches(s.src_zone_id, s.dst_zone_id)).sort((a, b) => byText(a.id, b.id))),
    links,
    named: namedGuests(zone, links),
  }
  const sides = peerSides(around)
  const { groups, books } = buildCircles(around, members, [...sides.left, ...sides.right], inside)
  const boxes = new Set(inside ? [...sides.left, ...sides.right].map(zoneNodeId) : [])
  if (members) addUnzoned(groups, books, around, unzoned)
  const gateways = new Set(sorted.map(z => z.gateway ?? '').filter(Boolean))
  // A host CIDR of a flow ("10.30.0.1/32") that is a zone's gateway is drawn on its own, as the gateway it is.
  const gatewayOf = (cidr: string) => {
    const ip = cidr.replace(/\/(32|128)$/, '')
    return ip !== cidr && gateways.has(ip) ? ip : undefined
  }
  const flowGateways = around.flows.flatMap(f => [gatewayOf(f.src_cidr), gatewayOf(f.dst_cidr)]).filter((ip): ip is string => !!ip)
  // An address of a named network is drawn as the box of that network (its CIDR).
  const named = networks ?? []
  const boxOf = (ip: string) => networkOf(ip, named)?.cidr ?? ip
  // Folded: only the gateways and the named networks keep a box, every other address talks from Unknown / External.
  const busiest = ownAddresses(around.seen, known, books, gateways, boxOf).filter(ip => externalAddresses || gateways.has(ip) || isNetworkBox(ip))
  const ips = [...new Set([...busiest, ...flowGateways])]
  const drawn = new Set(ips)

  const pairs = new Map<string, Pair>()
  addAllowedPairs(pairs, around.flows, known, cidr => {
    const ip = gatewayOf(cidr)
    return ip && drawn.has(ip) ? ipNodeId(ip) : undefined
  })
  exceptionPairs(pairs, around.links, groups, boxes)
  observedPairs(pairs, around.seen, known, books, drawn, boxOf)
  const ordered = [...pairs.values()].sort(comparePairs)

  // Each side nearest first: the peer zones next to the centre, External the furthest left.
  const peer = (id: string): Cell => (inside ? { id: zoneNodeId(id), w: BOX_W, h: BOX_H } : circle(groups.get(zoneNodeId(id))!))
  const per = inside ? MAX_BOXES_PER_COLUMN : MAX_PER_COLUMN
  const left: Cell[] = sides.left.map(peer)
  const unzonedGroup = groups.get(UNZONED_ID)
  if (unzonedGroup) left.push(circle(unzonedGroup))
  left.push(...ips.map(ip => box(ipNodeId(ip))))
  if (ordered.some(p => p.source === EXTERNAL_ID)) left.push(box(EXTERNAL_ID))
  const right: Cell[] = sides.right.map(peer)
  if (ordered.some(p => p.target === OUTSIDE_ID)) right.push(box(OUTSIDE_ID))
  const centreGroup = groups.get(zoneNodeId(centre))!
  const grid = [...columnsOf(left, per).reverse(), [circle(centreGroup)], ...columnsOf(right, per)]
  const rings = inside ? { centers: ringLayout(centreGroup.shown.length + (centreGroup.more ? 1 : 0)).centers, width: INSIDE_GUEST_W } : undefined
  const centers = inside ? cellCenters(grid, INSIDE_COL_GAP, INSIDE_ROW_GAP) : cellCenters(grid)
  const outsideEgress = outsideEgressOf(around.flows, known)

  const out: Placement = { nodes: [], obstacles: [], endShapes: new Map() }
  for (const cell of grid.flat()) {
    const c = centers.get(cell.id)!
    const group = groups.get(cell.id)
    if (group) placeGroup(out, group, c, group === centreGroup ? rings : undefined)
    else if (boxes.has(cell.id)) placeBox(out, known.get(cell.id.slice(5))!, members ? (members.get(cell.id.slice(5))?.length ?? 0) : null, 0, c)
    else if (cell.id.startsWith('ip:')) placeIp(out, cell.id.slice(3), c, sorted, named)
    else placeBoundary(out, cell.id, c, outsideEgress)
  }

  return { nodes: out.nodes, edges: placePairs(ordered, out.endShapes, out.obstacles, unapplied, gauges) }
}
