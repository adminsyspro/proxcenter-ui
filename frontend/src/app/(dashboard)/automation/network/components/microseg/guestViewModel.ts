import type { MicrosegFlow, MicrosegSuggestion, MicrosegZone } from '@/lib/microseg/types'

import { flowService } from './FlowSummary'
import type { Point } from './edgeGeometry'
import {
  BOX_SHAPE, EXTERNAL_ID, NODE_H, NODE_W, OUTSIDE_ID, UNZONED_ID, addAllowedPairs, addPair, addressBook, bareIp, cellCenters,
  comparePairs, groupOf, placeBoundary, placeGroup, placePairs, zoneNodeId,
  type AddressBooks, type Cell, type Group, type IpNodeData, type MapEdgeKind, type MapInput, type MapMember, type Pair,
  type Placement, type ZoneGraph,
} from './zoneGraph'
import { byText } from './zoneLayout'

/** The addresses in no zone drawn on their own (the busiest first); the others go to Unknown / External. */
export const MAX_IPS = 8

export const ipNodeId = (ip: string) => `ip:${ip}`

/** A peer zone with no guest drawn is a small circle; a side taller than MAX_PER_COLUMN nodes is split in columns. */
export const EMPTY_PEER_R = 70
export const MAX_PER_COLUMN = 3

export type GuestViewInput = MapInput & { centre: string }

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
function peerSides({ centre, known, flows, seen }: Around): { left: string[]; right: string[] } {
  const sources = new Set<string>()
  const peers = new Set<string>()
  const meet = (src: string, dst: string) => {
    for (const id of [src, dst]) if (known.has(id) && id !== centre.id) peers.add(id)
    if (dst === centre.id && known.has(src) && src !== centre.id) sources.add(src)
  }
  for (const f of flows) meet(f.src_zone_id, f.dst_zone_id)
  for (const s of seen) meet(s.src_zone_id, s.dst_zone_id)
  const byName = (a: string, b: string) => byText(known.get(a)!.name, known.get(b)!.name) || byText(a, b)
  const all = [...peers].sort(byName)
  return { left: all.filter(id => sources.has(id)), right: all.filter(id => !sources.has(id)) }
}

const hasAddress = (m: MapMember, ips: ReadonlySet<string> | undefined) => !!ips && m.ips.some(ip => ips.has(bareIp(ip)))

/** The circles: the centre with every member, each peer with only the members that talked to the centre. */
function buildCircles(around: Around, members: MapInput['members'], peers: string[]): { groups: Map<string, Group>; books: AddressBooks } {
  const groups = new Map<string, Group>()
  const books: AddressBooks = new Map()
  const involved = involvedAddresses(around)
  for (const id of [around.centre.id, ...peers]) {
    const z = around.known.get(id)!
    const all = members ? (members.get(id) ?? []) : null
    const drawn = all && id !== around.centre.id ? all.filter(m => hasAddress(m, involved.get(id))) : all
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

/** The guests in no zone that talked to the centre, in their own circle. */
function addUnzoned(groups: Map<string, Group>, books: AddressBooks, seen: MicrosegSuggestion[], known: ReadonlyMap<string, MicrosegZone>, unzoned: MapInput['unzoned']) {
  if (!unzoned?.length) return
  const sources = new Set(seen.filter(s => !known.has(s.src_zone_id) && s.src_ip).map(s => bareIp(s.src_ip)))
  const drawn = unzoned.filter(m => hasAddress(m, sources))
  if (!drawn.length) return
  const g = groupOf(UNZONED_ID, drawn, { kind: 'unzoned', count: drawn.length, radius: 0 })
  groups.set(UNZONED_ID, g)
  books.set(UNZONED_ID, addressBook(g))
}

/** The busiest addresses in no zone and no guest that talked to the centre, at most MAX_IPS. */
function ownAddresses(seen: MicrosegSuggestion[], known: ReadonlyMap<string, MicrosegZone>, books: AddressBooks): string[] {
  const hits = new Map<string, number>()
  for (const s of seen) {
    const ip = bareIp(s.src_ip || '')
    if (known.has(s.src_zone_id) || !ip || books.get(UNZONED_ID)?.has(ip)) continue
    hits.set(ip, (hits.get(ip) ?? 0) + s.hits)
  }
  return [...hits].sort((a, b) => b[1] - a[1] || byText(a[0], b[0])).slice(0, MAX_IPS).map(([ip]) => ip)
}

function observedPairs(pairs: Map<string, Pair>, seen: MicrosegSuggestion[], known: ReadonlyMap<string, MicrosegZone>, books: AddressBooks, ips: ReadonlySet<string>) {
  for (const s of seen) {
    const kind: MapEdgeKind = s.kind === 'blocked' ? 'blocked' : 'unprotected'
    const srcIp = bareIp(s.src_ip || '')
    let source: string
    if (known.has(s.src_zone_id)) source = books.get(s.src_zone_id)!.get(srcIp) ?? zoneNodeId(s.src_zone_id)
    else source = books.get(UNZONED_ID)?.get(srcIp) ?? (ips.has(srcIp) ? ipNodeId(srcIp) : EXTERNAL_ID)
    const target = books.get(s.dst_zone_id)!.get(bareIp(s.dst_ip || '')) ?? zoneNodeId(s.dst_zone_id)
    addPair(pairs, kind, source, target, flowService(s), undefined, s)
  }
}

function placeIp(out: Placement, ip: string, c: Point) {
  const id = ipNodeId(ip)
  out.nodes.push({ id, type: 'ip', position: { x: c.x - NODE_W / 2, y: c.y - NODE_H / 2 }, width: NODE_W, height: NODE_H, focusable: false, data: { kind: 'ip', ip } satisfies IpNodeData })
  out.obstacles.push({ id, center: c, shape: BOX_SHAPE })
  out.endShapes.set(id, { center: c, shape: BOX_SHAPE, group: id })
}

/** A side in columns of MAX_PER_COLUMN nodes at most, the first column nearest the centre. */
function columnsOf(side: Cell[]): Cell[][] {
  const columns: Cell[][] = []
  for (let i = 0; i < side.length; i += MAX_PER_COLUMN) columns.push(side.slice(i, i + MAX_PER_COLUMN))
  return columns
}

const box = (id: string): Cell => ({ id, w: NODE_W, h: NODE_H })
const circle = (g: Group): Cell => ({ id: g.id, w: 2 * g.radius, h: 2 * g.radius })

/**
 * The guest view, for an investigation: one zone in the centre with its guests (11 and a "+N" past 12). On its left
 * what talks to it (Unknown / External, the busiest addresses in no zone, the guests in no zone, the zones that send
 * to it), on its right what only it talks to (zones, Outside). The peers hold only the guests that talked to the
 * centre. Observed flows go guest to guest (one sample pair per observed flow, see UA28), allowed flows circle to
 * circle; nothing is drawn between two peers. Pure and deterministic.
 */
export function buildGuestView({ zones, flows, suggestions, members = null, unzoned = null, unapplied = null, centre }: GuestViewInput): ZoneGraph {
  const sorted = [...zones].sort((a, b) => byText(a.name, b.name) || byText(a.id, b.id))
  const known = new Map(sorted.map(z => [z.id, z]))
  const zone = known.get(centre)
  if (!zone) return { nodes: [], edges: [] }
  const touches = (src: string, dst: string) => src === centre || dst === centre
  const around: Around = {
    centre: zone,
    known,
    flows: flows.filter(f => touches(f.src_zone_id, f.dst_zone_id)).sort((a, b) => byText(a.id, b.id)),
    seen: pending(suggestions, known).filter(s => touches(s.src_zone_id, s.dst_zone_id)).sort((a, b) => byText(a.id, b.id)),
  }
  const sides = peerSides(around)
  const { groups, books } = buildCircles(around, members, [...sides.left, ...sides.right])
  if (members) addUnzoned(groups, books, around.seen, known, unzoned)
  const ips = ownAddresses(around.seen, known, books)

  const pairs = new Map<string, Pair>()
  addAllowedPairs(pairs, around.flows, known)
  observedPairs(pairs, around.seen, known, books, new Set(ips))
  const ordered = [...pairs.values()].sort(comparePairs)

  // Each side nearest first: the peer zones next to the centre, External the furthest left.
  const left: Cell[] = sides.left.map(id => circle(groups.get(zoneNodeId(id))!))
  const unzonedGroup = groups.get(UNZONED_ID)
  if (unzonedGroup) left.push(circle(unzonedGroup))
  left.push(...ips.map(ip => box(ipNodeId(ip))))
  if (ordered.some(p => p.source === EXTERNAL_ID)) left.push(box(EXTERNAL_ID))
  const right: Cell[] = sides.right.map(id => circle(groups.get(zoneNodeId(id))!))
  if (ordered.some(p => p.target === OUTSIDE_ID)) right.push(box(OUTSIDE_ID))
  const grid = [...columnsOf(left).reverse(), [circle(groups.get(zoneNodeId(centre))!)], ...columnsOf(right)]
  const centers = cellCenters(grid)

  const out: Placement = { nodes: [], obstacles: [], endShapes: new Map() }
  for (const cell of grid.flat()) {
    const c = centers.get(cell.id)!
    const group = groups.get(cell.id)
    if (group) placeGroup(out, group, c)
    else if (cell.id.startsWith('ip:')) placeIp(out, cell.id.slice(3), c)
    else placeBoundary(out, cell.id, c)
  }

  return { nodes: out.nodes, edges: placePairs(ordered, out.endShapes, out.obstacles, unapplied) }
}
