import type { CSSProperties } from 'react'

import { MarkerType, type Edge, type Node } from '@xyflow/react'

import type { MicrosegFlow, MicrosegSuggestion, MicrosegZone, ZoneState } from '@/lib/microseg/types'

import { flowService } from './FlowSummary'
import { placeEdges, type EdgeEnds, type Obstacle, type PlacedEdge } from './zoneGraphEdges'
import { GLYPH_Y, GUEST_H, GUEST_R, GUEST_W, circleRadius, layerZones, memberSlots, orderLayers, slotPositions, type Point } from './zoneLayout'

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

/** One green for every allowed flow (the zone colour stays on its circle), blue for blocked, dashed red for unprotected. */
export const EDGE_COLORS = { allowed: '#2e7d32', blocked: '#1565c0', unprotected: '#e53935', outside: '#9e9e9e' } as const

/** A guest drawn on the map. */
export type MapMember = {
  key: string
  name: string
  vmid: number
  node: string
  type: 'qemu' | 'lxc'
  status: string
  ips: string[]
  /** Queued for the zone, not tagged yet. */
  pending: boolean
}

export type ZoneNodeData = {
  kind: 'zone'
  zone: MicrosegZone
  /** Null while the guests of the connection are not known. */
  members: number | null
  state: ZoneState
  radius: number
}
export type UnzonedNodeData = { kind: 'unzoned'; count: number; radius: number }
export type GuestNodeData = { kind: 'guest'; member: MapMember; groupId: string }
export type MoreNodeData = { kind: 'more'; count: number; groupId: string }
export type BoundaryNodeData = { kind: 'external' | 'outside' }
export type MapNodeData = ZoneNodeData | UnzonedNodeData | GuestNodeData | MoreNodeData | BoundaryNodeData

export type MapEdgeKind = 'allowed' | 'unprotected' | 'blocked' | 'outside'

export type MapEdgeData = {
  kind: MapEdgeKind
  /** protocol/ports tokens of the flows (or observed flows) the edge stands for, sorted. */
  services: string[]
  /** The label: the ports grouped per protocol. */
  label: string
  count: number
  /** The allowed flows of the edge (allowed and outside edges). */
  flows: MicrosegFlow[]
  /** The observed flows of the edge (unprotected and blocked edges). */
  observed: MicrosegSuggestion[]
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
}

export type MapInput = {
  zones: MicrosegZone[]
  flows: MicrosegFlow[]
  suggestions: MicrosegSuggestion[]
  /** The members of each zone; null while the guests are unknown (no guest drawn, counts unknown). */
  members?: ReadonlyMap<string, MapMember[]> | null
  /** The running guests in no zone. */
  unzoned?: MapMember[] | null
  /** Ids of the flows of the draft that are not applied yet. */
  unapplied?: ReadonlySet<string> | null
}

export type ZoneGraph = { nodes: Node[]; edges: Edge[] }

function byText(a: string, b: string): number {
  if (a < b) return -1
  return a > b ? 1 : 0
}
const KIND_RANK: Record<MapEdgeKind, number> = { allowed: 0, outside: 1, unprotected: 2, blocked: 3 }

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
 * without port is its name alone ("icmp").
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
  const part = (proto: string, sep: string) => {
    const list = [...ports.get(proto)!].sort(portOrder)
    return list.length ? `${proto}${sep}${list.join(', ')}` : proto
  }
  return protos.length === 1 ? part(protos[0], '/') : protos.map(p => part(p, ' ')).join(' · ')
}

/** `all` is every member in name order, `shown` the ones drawn. */
type Group = { id: string; radius: number; all: MapMember[]; shown: MapMember[]; more: number; data: ZoneNodeData | UnzonedNodeData }
type Pair = { kind: MapEdgeKind; source: string; target: string; services: Set<string>; flows: MicrosegFlow[]; observed: MicrosegSuggestion[] }
type Cell = { id: string; w: number; h: number }
type AddressBooks = Map<string, Map<string, string>>
type Placement = { nodes: Node[]; obstacles: Obstacle[]; endShapes: Map<string, EdgeEnds> }

const BOX_SHAPE = { kind: 'box' as const, halfW: NODE_W / 2, halfH: NODE_H / 2 }

function groupOf(id: string, members: MapMember[] | null, data: Group['data']): Group {
  const list = [...(members ?? [])].sort((a, b) => byText(a.name, b.name) || byText(a.key, b.key))
  const { shown, more } = memberSlots(list.length)
  const radius = circleRadius(shown + (more ? 1 : 0))
  data.radius = radius
  return { id, radius, all: list, shown: list.slice(0, shown), more, data }
}

/** The id a group's guest nodes carry: the zone id, or "unzoned". */
const groupKey = (group: Group) => (group.id === UNZONED_ID ? UNZONED_ID : group.id.replace(/^zone:/, ''))

/**
 * Where an address of a group's members is drawn: its guest node, or the "+N" node when it is not drawn. An address
 * two guests share goes to the first by name (whatever the order of the inventory).
 */
function addressBook(group: Group): Map<string, string> {
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

function addPair(pairs: Map<string, Pair>, kind: MapEdgeKind, source: string, target: string, service: string, flow?: MicrosegFlow, seen?: MicrosegSuggestion) {
  if (source === target) return
  const key = pairKey({ kind, source, target })
  const pair = pairs.get(key) ?? { kind, source, target, services: new Set<string>(), flows: [], observed: [] }
  pair.services.add(service)
  if (flow) pair.flows.push(flow)
  if (seen) pair.observed.push(seen)
  pairs.set(key, pair)
}

/** An end of an allowed flow: the box for a CIDR, the circle of a known zone, nothing for a zone that is gone. */
function allowedEnd(cidr: string, zoneId: string, box: string, known: ReadonlyMap<string, MicrosegZone>): string | null {
  if (cidr) return box
  return known.has(zoneId) ? zoneNodeId(zoneId) : null
}

/** The allowed flows, circle to circle (a CIDR source from External, a CIDR destination to Outside). */
function addAllowedPairs(pairs: Map<string, Pair>, flows: MicrosegFlow[], known: ReadonlyMap<string, MicrosegZone>) {
  for (const f of flows) {
    const source = allowedEnd(f.src_cidr, f.src_zone_id, EXTERNAL_ID, known)
    const target = allowedEnd(f.dst_cidr, f.dst_zone_id, OUTSIDE_ID, known)
    if (!source || !target || (source === EXTERNAL_ID && target === OUTSIDE_ID)) continue
    addPair(pairs, target === OUTSIDE_ID ? 'outside' : 'allowed', source, target, flowService(f), f)
  }
}

/** The source of an observed flow: its guest (or its zone's circle), a guest in no zone, or External. */
function observedSource(s: MicrosegSuggestion, known: ReadonlyMap<string, MicrosegZone>, books: AddressBooks): string {
  const srcIp = bareIp(s.src_ip || '')
  if (known.has(s.src_zone_id)) return books.get(s.src_zone_id)!.get(srcIp) ?? zoneNodeId(s.src_zone_id)
  return books.get(UNZONED_ID)?.get(srcIp) ?? EXTERNAL_ID
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

const comparePairs = (a: Pair, b: Pair) => KIND_RANK[a.kind] - KIND_RANK[b.kind] || byText(a.source, b.source) || byText(a.target, b.target)

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

/** The center of every cell: the columns side by side, each centered on y = 0. */
function cellCenters(grid: Cell[][]): Map<string, Point> {
  const centers = new Map<string, Point>()
  let left = 0
  for (const column of grid) {
    const width = Math.max(...column.map(c => c.w))
    const height = column.reduce((s, c) => s + c.h, 0) + ROW_GAP * (column.length - 1)
    let top = -height / 2
    for (const c of column) {
      centers.set(c.id, { x: Math.round(left + width / 2), y: Math.round(top + c.h / 2) })
      top += c.h + ROW_GAP
    }
    left += width + COL_GAP
  }
  return centers
}

function placeBoundary(out: Placement, id: string, c: Point) {
  out.nodes.push({
    id, type: 'boundary', position: { x: c.x - NODE_W / 2, y: c.y - NODE_H / 2 }, width: NODE_W, height: NODE_H, focusable: false,
    data: { kind: id === EXTERNAL_ID ? 'external' : 'outside' } satisfies BoundaryNodeData,
  })
  out.obstacles.push({ id, center: c, shape: BOX_SHAPE })
  out.endShapes.set(id, { center: c, shape: BOX_SHAPE, group: id })
}

/** A circle, then its guests and its "+N" node (React Flow wants a parent before its children). */
function placeGroup(out: Placement, group: Group, c: Point) {
  const r = group.radius
  const origin = { x: c.x - r, y: c.y - r }
  out.nodes.push({ id: group.id, type: group.data.kind, position: origin, width: 2 * r, height: 2 * r, focusable: false, data: group.data })
  out.obstacles.push({ id: group.id, center: c, shape: { kind: 'circle', r } })
  out.endShapes.set(group.id, { center: c, shape: { kind: 'circle', r }, group: group.id })
  const groupId = groupKey(group)
  const spots = slotPositions(group.shown.length + (group.more ? 1 : 0), r)
  const child = (id: string, spot: Point, data: GuestNodeData | MoreNodeData) => {
    out.nodes.push({ id, type: data.kind, parentId: group.id, position: spot, width: GUEST_W, height: GUEST_H, focusable: false, data })
    out.endShapes.set(id, { center: { x: origin.x + spot.x + GUEST_W / 2, y: origin.y + spot.y + GLYPH_Y }, shape: { kind: 'circle', r: GUEST_R }, group: group.id })
  }
  group.shown.forEach((m, i) => child(guestNodeId(groupId, m.key), spots[i], { kind: 'guest', member: m, groupId }))
  if (group.more) child(moreNodeId(groupId), spots[spots.length - 1], { kind: 'more', count: group.more, groupId })
}

/** The nodes in grid order, with the obstacles the edges avoid and the outline every edge end clips on. */
function buildNodes(grid: Cell[][], centers: Map<string, Point>, groups: Map<string, Group>): Placement {
  const out: Placement = { nodes: [], obstacles: [], endShapes: new Map() }
  for (const cell of grid.flat()) {
    const c = centers.get(cell.id)!
    const group = groups.get(cell.id)
    if (group) placeGroup(out, group, c)
    else placeBoundary(out, cell.id, c)
  }
  return out
}

/** Unprotected and Outside edges are dashed, a draft-only edge dotted, the others solid. */
function edgeDash(kind: MapEdgeKind, draft: boolean): string | undefined {
  if (kind === 'unprotected' || kind === 'outside') return '6 4'
  return draft ? '1 5' : undefined
}

function dashStyle(dash: string | undefined, draft: boolean): Pick<CSSProperties, 'strokeDasharray' | 'strokeLinecap'> {
  if (!dash) return {}
  return { strokeDasharray: dash, strokeLinecap: draft ? 'round' : undefined }
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
      flows: [...p.flows].sort((a, b) => byText(a.id, b.id)),
      observed: [...p.observed].sort((a, b) => byText(a.id, b.id)),
      draft,
      fromGroup: endShapes.get(p.source)!.group,
      toGroup: endShapes.get(p.target)!.group,
      path: place.path,
      points: place.points,
      label_x: place.label.x,
      label_y: place.label.y,
      label_w: place.label.w,
      label_h: place.label.h,
      small: observed,
      particle: p.kind === 'allowed' && !draft,
      color,
    } satisfies MapEdgeData,
  }
}

/**
 * The map: a circle per zone holding its guests (11 and a "+N" past 12), a dashed circle of the running guests in
 * no zone, an "Unknown / External" box for the sources in no zone and an Outside box for the CIDR destinations.
 * Allowed flows go circle to circle, one green edge per ordered pair; observed flows (unprotected, blocked) go guest
 * to guest, resolved from their addresses (the circle when the address is no drawn guest's). Circles on a grid:
 * longest-path layer as the column, barycenter order as the row. Pure and deterministic.
 */
export function buildZoneGraph({ zones, flows, suggestions, members = null, unzoned = null, unapplied = null }: MapInput): ZoneGraph {
  const sorted = [...zones].sort((a, b) => byText(a.name, b.name) || byText(a.id, b.id))
  const known = new Map(sorted.map(z => [z.id, z]))
  const zoneFlows = flows.filter(f => !f.src_cidr && !f.dst_cidr && known.has(f.src_zone_id) && known.has(f.dst_zone_id))
  const layerEdges = zoneFlows.map(f => [f.src_zone_id, f.dst_zone_id] as [string, string])
  const { groups, books } = buildGroups(sorted, members, unzoned)

  // Edges, by their ends.
  const pairs = new Map<string, Pair>()
  addAllowedPairs(pairs, flows, known)
  addObservedPairs(pairs, suggestions, known, books)
  const ordered = [...pairs.values()].sort(comparePairs)

  // Grid: longest-path layer as the column, barycenter order as the row.
  const fromExternal = flows.filter(f => f.src_cidr && known.has(f.dst_zone_id) && !f.dst_cidr).map(f => f.dst_zone_id)
  const layer = layerZones(sorted.map(z => z.id), layerEdges, fromExternal)
  const columns = orderLayers(layer, layerEdges, id => known.get(id)!.name)
  const grid = buildGrid(columns, groups, ordered.some(p => p.source === EXTERNAL_ID), ordered.some(p => p.target === OUTSIDE_ID))
  const { nodes, obstacles, endShapes } = buildNodes(grid, cellCenters(grid), groups)

  const placed = placeEdges(
    ordered.map(p => ({ id: pairKey(p), source: p.source, target: p.target, label: groupServices([...p.services]), small: isObserved(p.kind) })),
    endShapes,
    obstacles,
  )
  const edges: Edge[] = ordered.flatMap(p => {
    const place = placed.get(pairKey(p))
    return place ? [toEdge(p, place, endShapes, unapplied)] : []
  })

  return { nodes, edges }
}

export type FlowFilters = { allowed: boolean; unprotected: boolean; blocked: boolean }
export const ALL_FLOWS: FlowFilters = { allowed: true, unprotected: true, blocked: true }
/** The checkbox of the toolbar each kind of edge follows. */
const FILTER_OF_KIND: Record<MapEdgeKind, keyof FlowFilters> = { allowed: 'allowed', outside: 'allowed', unprotected: 'unprotected', blocked: 'blocked' }

/** The edges the three checkboxes of the toolbar let through (the flows to Outside are allowed flows). */
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
