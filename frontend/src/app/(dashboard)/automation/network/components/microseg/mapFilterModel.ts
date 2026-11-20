import type { MicrosegSuggestion, MicrosegZone } from '@/lib/microseg/types'

import type { MatrixModel } from './matrixModel'
import { MAX_OPTIONS, matchesTarget, targetAddresses, targetNodeId, type TargetGuest } from './targetModel'
import { bareIp, pveNodeId, zoneNodeId, type MapCluster, type MapInput, type ZoneGraph } from './zoneGraph'
import { byText } from './zoneLayout'

/**
 * One thing the map is filtered on: a guest, a zone, a Proxmox node (the guests that run on it) or, on a policy
 * shared by several clusters, a cluster (its guests). `id` is unique across the kinds: it is the key of the pick.
 */
export type FilterItem =
  | { kind: 'guest'; id: string; guest: TargetGuest }
  | { kind: 'zone'; id: string; zone: MicrosegZone }
  | { kind: 'node'; id: string; node: string; connectionId: string; guests: number; cluster?: MapCluster }
  | { kind: 'cluster'; id: string; cluster: MapCluster; guests: number }

export type FilterKind = FilterItem['kind']
/** The order of the kinds in the list of the picker. */
export const FILTER_KINDS: readonly FilterKind[] = ['zone', 'node', 'cluster', 'guest']

export const zoneItemId = (zoneId: string) => `zone:${zoneId}`
export const nodeItemId = (connectionId: string, node: string) => `node:${connectionId}/${node}`
export const clusterItemId = (connectionId: string) => `cluster:${connectionId}`
/** A guest is picked by its guestId (the key the single target always used, and the one a `?vm=` link resolves to). */
export const guestItemId = (guest: Pick<TargetGuest, 'id'>) => guest.id

export const itemName = (item: FilterItem): string => {
  if (item.kind === 'guest') return item.guest.name
  if (item.kind === 'zone') return item.zone.name
  if (item.kind === 'node') return item.node
  return item.cluster.name
}

/**
 * Everything the map can be filtered on: the zones by name, the Proxmox nodes that run a guest (each in its cluster
 * on a shared policy: two clusters may each have a "pve1"), the clusters of a shared policy, then the running guests.
 * `clusters`: the clusters of a shared policy the map reads (null on a policy of one cluster). Pure.
 */
export function filterItems(zones: readonly MicrosegZone[], candidates: readonly TargetGuest[], clusters: readonly MapCluster[] | null): FilterItem[] {
  const clusterOf = new Map((clusters ?? []).map(c => [c.id, c]))
  const perNode = new Map<string, { node: string; connectionId: string; guests: number }>()
  const perCluster = new Map<string, number>()
  for (const g of candidates) {
    const key = nodeItemId(g.connectionId, g.node)
    const entry = perNode.get(key) ?? { node: g.node, connectionId: g.connectionId, guests: 0 }
    entry.guests++
    perNode.set(key, entry)
    perCluster.set(g.connectionId, (perCluster.get(g.connectionId) ?? 0) + 1)
  }
  const zoneItems = [...zones].sort((a, b) => byText(a.name, b.name) || byText(a.id, b.id)).map((zone): FilterItem => ({ kind: 'zone', id: zoneItemId(zone.id), zone }))
  const nodeItems = [...perNode.entries()]
    .map(([id, n]): FilterItem => ({ kind: 'node', id, ...n, ...(clusterOf.has(n.connectionId) ? { cluster: clusterOf.get(n.connectionId) } : {}) }))
    .sort((a, b) => byText(itemName(a), itemName(b)) || byText(a.id, b.id))
  const clusterItems = (clusters ?? []).map((cluster): FilterItem => ({ kind: 'cluster', id: clusterItemId(cluster.id), cluster, guests: perCluster.get(cluster.id) ?? 0 }))
  const guestItems = candidates.map((guest): FilterItem => ({ kind: 'guest', id: guestItemId(guest), guest }))
  return [...zoneItems, ...nodeItems, ...clusterItems, ...guestItems]
}

/** An item matches a search: a guest on its name, VMID or address (like the single target did), the others on their name. */
export function matchesItem(item: FilterItem, query: string): boolean {
  if (item.kind === 'guest') return matchesTarget(item.guest, query)
  const q = query.trim().toLowerCase()
  return !q || itemName(item).toLowerCase().includes(q)
}

/** The options of the picker for a search: every zone, node and cluster that matches, then the first MAX_OPTIONS guests. */
export function searchItems(items: readonly FilterItem[], query: string): FilterItem[] {
  const matching = items.filter(item => matchesItem(item, query))
  const guests = matching.filter(item => item.kind === 'guest')
  return [...matching.filter(item => item.kind !== 'guest'), ...guests.slice(0, MAX_OPTIONS)]
}

/** What the picked items stand for on the map, read once per pick (then matched against many flows and edges). */
export type MapFilter = {
  items: readonly FilterItem[]
  /**
   * Only the flows between two of the picked things are kept (it takes two things or more); false: every flow of the
   * picked things, with what they exchange with.
   */
  between: boolean
  /** The guests the filter names: picked one by one, or through their node or their cluster. */
  guests: readonly TargetGuest[]
  /** Their addresses, in their canonical form. */
  ips: ReadonlySet<string>
  /** The zones picked as zones. */
  zoneIds: ReadonlySet<string>
  /** The zones of the guests the filter names: kept on the map with all their members, so that the guests are drawn in them. */
  guestZoneIds: ReadonlySet<string>
  /** The only thing picked when it is one guest: the single target, with its panel. */
  single: TargetGuest | null
}

/** The filter of the picked items (null: nothing picked, the map is not filtered). Pure. */
export function mapFilter(items: readonly FilterItem[], candidates: readonly TargetGuest[], between: boolean): MapFilter | null {
  if (items.length === 0) return null
  const nodes = new Set(items.flatMap(i => (i.kind === 'node' ? [nodeItemId(i.connectionId, i.node)] : [])))
  const clusters = new Set(items.flatMap(i => (i.kind === 'cluster' ? [i.cluster.id] : [])))
  const picked = new Map(items.flatMap(i => (i.kind === 'guest' ? [[i.guest.id, i.guest] as const] : [])))
  for (const g of candidates) {
    if (nodes.has(nodeItemId(g.connectionId, g.node)) || clusters.has(g.connectionId)) picked.set(g.id, g)
  }
  const guests = [...picked.values()]
  const only = items.length === 1 ? items[0] : null
  return {
    items,
    between: between && items.length > 1,
    guests,
    ips: new Set(guests.flatMap(g => [...targetAddresses(g)])),
    zoneIds: new Set(items.flatMap(i => (i.kind === 'zone' ? [i.zone.id] : []))),
    guestZoneIds: new Set(guests.flatMap(g => (g.zoneId ? [g.zoneId] : []))),
    single: only?.kind === 'guest' ? only.guest : null,
  }
}

type Flow = Pick<MicrosegSuggestion, 'src_ip' | 'dst_ip' | 'src_zone_id' | 'dst_zone_id' | 'pairs'>

/** The pairs of addresses of an observed flow: the ones it counts, else its sample pair. */
function flowPairs(s: Flow): { src_ip: string; dst_ip: string }[] {
  const pairs = (Array.isArray(s.pairs) ? s.pairs : []).filter(p => !!p && typeof p.src_ip === 'string' && typeof p.dst_ip === 'string')
  return [{ src_ip: s.src_ip, dst_ip: s.dst_ip }, ...pairs]
}

/**
 * An observed flow the filter keeps: one of its ends is an address of a named guest or in a zone picked as a zone;
 * with `between`, both of its ends are.
 */
export function keepsFlow(f: Pick<MapFilter, 'ips' | 'zoneIds' | 'between'>, s: Flow): boolean {
  const picked = (ip: string, zoneId: string) => (!!ip && f.ips.has(bareIp(ip))) || (!!zoneId && f.zoneIds.has(zoneId))
  return flowPairs(s).some(p => {
    const from = picked(p.src_ip, s.src_zone_id)
    const to = picked(p.dst_ip, s.dst_zone_id)
    return f.between ? from && to : from || to
  })
}

/**
 * What the map draws once filtered: its input reduced to what the filter keeps, so that every rendering lays out
 * only that. The allowed flows of the zones picked (between two of them with `between`, else every flow of one of
 * them), the observed flows the filter keeps, then the zones these flows end on, the zones picked and the zones of the
 * named guests, each with all its members; of the guests in no zone, those the filter names and those at an end of a
 * flow kept; the Proxmox nodes that still hold a guest, and those picked. Pure.
 */
export function filterInput(input: MapInput, f: MapFilter): MapInput {
  const picked = (zoneId: string, cidr: string) => !cidr && !!zoneId && f.zoneIds.has(zoneId)
  const flows = input.flows.filter(flow => {
    const from = picked(flow.src_zone_id, flow.src_cidr)
    const to = picked(flow.dst_zone_id, flow.dst_cidr)
    return f.between ? from && to : from || to
  })
  const suggestions = input.suggestions.filter(s => keepsFlow(f, s))
  const zoneIds = new Set([...f.zoneIds, ...f.guestZoneIds])
  for (const flow of flows) {
    if (!flow.src_cidr && flow.src_zone_id) zoneIds.add(flow.src_zone_id)
    if (!flow.dst_cidr && flow.dst_zone_id) zoneIds.add(flow.dst_zone_id)
  }
  const ends = new Set<string>()
  for (const s of suggestions) {
    if (s.src_zone_id) zoneIds.add(s.src_zone_id)
    if (s.dst_zone_id) zoneIds.add(s.dst_zone_id)
    for (const pair of flowPairs(s)) for (const ip of [pair.src_ip, pair.dst_ip]) if (ip) ends.add(bareIp(ip))
  }
  const named = new Set(f.guests.map(g => g.key))
  const members = input.members ? new Map([...input.members].filter(([zoneId]) => zoneIds.has(zoneId))) : input.members
  const unzoned = input.unzoned ? input.unzoned.filter(m => named.has(m.key) || m.ips.some(ip => ends.has(bareIp(ip)))) : input.unzoned
  // A Proxmox node is named in its cluster on a shared policy: two clusters may each have a "pve1".
  const nodeKey = (cluster: string | undefined, node: string) => `${cluster ?? ''}/${node}`
  const holding = new Set([...(members ? [...members.values()].flat() : []), ...(unzoned ?? [])].map(m => nodeKey(m.cluster?.id, m.node)))
  const pickedNodes = new Set(f.items.flatMap(i => (i.kind === 'node' ? [nodeKey(i.cluster?.id, i.node)] : [])))
  const pveNodes = input.pveNodes ? input.pveNodes.filter(n => holding.has(nodeKey(n.cluster, n.node)) || pickedNodes.has(nodeKey(n.cluster, n.node))) : input.pveNodes
  return {
    ...input,
    zones: input.zones.filter(z => zoneIds.has(z.id)),
    flows,
    suggestions,
    members,
    unzoned,
    exceptions: input.exceptions ? input.exceptions.filter(e => zoneIds.has(e.zone_id)) : input.exceptions,
    pveNodes,
  }
}

/**
 * The nodes of a canvas that stand for what was picked, with the colour of their ring ('' for the theme's primary
 * colour): a zone picked, the glyph of a guest picked on its own (or what stands for it), the circle of a Proxmox
 * node picked on the node view. `ringOf` gives the colour of a zone. They are ringed when the map also shows what
 * the picks exchange with: it tells the picks from their peers.
 */
export function filterMarks(graph: ZoneGraph, f: MapFilter, ringOf: (zoneId: string | null) => string = () => ''): Map<string, string> {
  const ids = new Set(graph.nodes.map(n => n.id))
  const marks = new Map<string, string>()
  for (const item of f.items) {
    if (item.kind === 'zone') {
      if (ids.has(zoneNodeId(item.zone.id))) marks.set(zoneNodeId(item.zone.id), ringOf(item.zone.id))
    } else if (item.kind === 'guest') {
      const node = targetNodeId(graph, item.guest)
      if (node) marks.set(node, ringOf(item.guest.zoneId))
    } else if (item.kind === 'node') {
      const node = [pveNodeId(item.node, item.connectionId), pveNodeId(item.node)].find(id => ids.has(id))
      if (node) marks.set(node, '')
    }
  }
  return marks
}

/** The matrix of a filtered map without its boundary row (Unknown / External) and column (Outside) when no pair kept uses them. */
export function trimMatrix(model: MatrixModel): MatrixModel {
  const sources = new Set([...model.cells.values()].map(c => c.source))
  const targets = new Set([...model.cells.values()].map(c => c.target))
  return { ...model, rows: model.rows.filter(r => r.kind === 'zone' || sources.has(r.id)), cols: model.cols.filter(c => c.kind === 'zone' || targets.has(c.id)) }
}

/** The zone a filter puts in the centre of the guest view: the first zone picked, else the zone of the first guest picked (null: none). */
export function filterCentre(items: readonly FilterItem[]): string | null {
  for (const item of items) if (item.kind === 'zone') return item.zone.id
  for (const item of items) if (item.kind === 'guest' && item.guest.zoneId) return item.guest.zoneId
  return null
}

/**
 * What the list of the filter offers inside an entered zone: what the map draws around it. The zones drawn (the entered
 * one and those it exchanges with), the guests drawn on their own and every member of the entered zone (those past
 * the ones drawn are in its "+N"), then the Proxmox nodes and the clusters of those guests, each with the count of
 * them it holds. `graph` is the map of the
 * entered zone, before any filter, so that a pick never hides what can still be added. Pure.
 */
export function itemsInView(items: readonly FilterItem[], graph: ZoneGraph, entered: string): FilterItem[] {
  const zones = new Set<string>([entered])
  const keys = new Set<string>()
  for (const n of graph.nodes) {
    const d = n.data as { kind?: string; zone?: { id: string }; member?: { key: string } }
    if (d.kind === 'zone' && d.zone) zones.add(d.zone.id)
    else if (d.kind === 'guest' && d.member) keys.add(d.member.key)
  }
  const guests = items.flatMap(i => (i.kind === 'guest' && (keys.has(i.guest.key) || i.guest.zoneId === entered) ? [i.guest] : []))
  // A node or a cluster counts the guests of the view it holds.
  const nodes = new Map<string, number>()
  const clusters = new Map<string, number>()
  for (const g of guests) {
    const node = nodeItemId(g.connectionId, g.node)
    nodes.set(node, (nodes.get(node) ?? 0) + 1)
    clusters.set(g.connectionId, (clusters.get(g.connectionId) ?? 0) + 1)
  }
  const ids = new Set(guests.map(g => g.id))
  return items.flatMap((i): FilterItem[] => {
    if (i.kind === 'zone') return zones.has(i.zone.id) ? [i] : []
    if (i.kind === 'guest') return ids.has(i.guest.id) ? [i] : []
    if (i.kind === 'node') return nodes.has(i.id) ? [{ ...i, guests: nodes.get(i.id)! }] : []
    return clusters.has(i.cluster.id) ? [{ ...i, guests: clusters.get(i.cluster.id)! }] : []
  })
}
