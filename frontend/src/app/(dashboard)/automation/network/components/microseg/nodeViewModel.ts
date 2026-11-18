import type { Node } from '@xyflow/react'

import type { MicrosegZone } from '@/lib/microseg/types'

import { flowService } from './FlowSummary'
import type { Point } from './edgeGeometry'
import {
  EDGE_COLORS, addPair, bareIp, cellCenters, comparePairs, exceptionLinks, groupOf, isSharedMap, placeGroup, placePairs, pveClusterId, pveNodeId,
  type Cell, type FlowFilters, type GuestNodeData, type GuestPair, type Group, type MapCluster, type MapEdgeData, type MapEdgeKind, type MapInput,
  type MapMember, type Pair, type Placement, type PveClusterData, type PveNodeData, type PveZoneShare, type ZoneGraph,
} from './zoneGraph'
import { byText } from './zoneLayout'

/** The colour of a guest in no zone: the grey of what is outside the zones. */
export const UNZONED_COLOR = EDGE_COLORS.outside

/** Around the nodes of one cluster on a shared policy: the room inside its frame, its title line, and between two frames. */
export const FRAME_PAD = 40
export const FRAME_HEAD = 44
export const FRAME_GAP = 160

/**
 * A guest of the view: where it runs (`pve`, the id of its node's circle, in its cluster on a shared policy) and the
 * zone it belongs to (null: none).
 */
type Placed = { member: MapMember; zone: MicrosegZone | null; pve: string }

const byName = (a: Placed, b: Placed) => byText(a.member.name, b.member.name) || byText(a.member.key, b.member.key)

/** The circle of the node a guest runs on: on a shared policy, the node of its own cluster. */
const pveOf = (m: MapMember, shared: boolean) => pveNodeId(m.node, shared ? m.cluster?.id : undefined)

/**
 * Every guest the map knows, once, by its key ("qemu/101", or "c2/qemu/101" on a shared policy): the members of the
 * zones, then the running guests in no zone. A guest two zones hold (a change of zone that is queued) is of the first
 * by name, as on the other renderings.
 */
function placedGuests(sorted: MicrosegZone[], members: ReadonlyMap<string, MapMember[]>, unzoned: MapInput['unzoned'], shared: boolean): Map<string, Placed> {
  const guests = new Map<string, Placed>()
  for (const zone of sorted) {
    for (const member of members.get(zone.id) ?? []) if (!guests.has(member.key)) guests.set(member.key, { member, zone, pve: pveOf(member, shared) })
  }
  for (const member of unzoned ?? []) if (!guests.has(member.key)) guests.set(member.key, { member, zone: null, pve: pveOf(member, shared) })
  return guests
}

/**
 * The guest of an address, in the whole connection: the zone an observed flow names for its source is the one the
 * guest had when it was seen (none, for a guest put in a zone since), so the address alone finds the guest. An address
 * two guests share goes to the first by name.
 */
function addressBook(guests: ReadonlyMap<string, Placed>): Map<string, Placed> {
  const book = new Map<string, Placed>()
  for (const p of [...guests.values()].sort(byName)) for (const ip of p.member.ips) if (!book.has(bareIp(ip))) book.set(bareIp(ip), p)
  return book
}

/** The guests an edge stands for, by edge id, then by pair of guests. */
type Note = { key: string; from: string; to: string; services: Set<string> }
type PairNotes = Map<string, Map<string, Note>>

function note(notes: PairNotes, kind: MapEdgeKind, source: Placed, target: Placed, service: string) {
  const id = `${kind}:${source.pve}>${target.pve}`
  const pairs = notes.get(id) ?? new Map<string, Note>()
  const key = `${source.member.key}>${target.member.key}`
  const pair = pairs.get(key) ?? { key, from: source.member.name, to: target.member.name, services: new Set<string>() }
  pair.services.add(service)
  pairs.set(key, pair)
  notes.set(id, pairs)
}

const guestPairsOf = (pairs: ReadonlyMap<string, Note> | undefined): GuestPair[] =>
  [...(pairs?.values() ?? [])]
    .map(p => ({ key: p.key, from: p.from, to: p.to, services: [...p.services].sort(byText) }))
    .sort((a, b) => byText(a.from, b.from) || byText(a.to, b.to) || byText(a.key, b.key))

/** The nodes in columns, as square a grid as their number allows: three nodes make a triangle, four a square. */
function nodeGrid(groups: Group[]): Cell[][] {
  const columns = Math.ceil(Math.sqrt(groups.length))
  const perColumn = Math.ceil(groups.length / Math.max(1, columns))
  const grid: Cell[][] = []
  for (let i = 0; i < groups.length; i += perColumn) grid.push(groups.slice(i, i + perColumn).map(g => ({ id: g.id, w: 2 * g.radius, h: 2 * g.radius })))
  return grid
}

/** A cluster's frame and the circles of its nodes, placed. */
type Block = { cluster: MapCluster; groups: Group[] }

/**
 * The node view of a shared policy: the nodes of each cluster on their own grid, in a frame headed by the cluster's
 * name; the frames side by side, centred on y = 0, FRAME_GAP apart. The frames come first (drawn under the circles).
 */
function placeBlocks(blocks: readonly Block[]): { frames: Placement['nodes']; centers: Map<string, Point> } {
  const frames: Placement['nodes'] = []
  const centers = new Map<string, Point>()
  let left = 0
  for (const { cluster, groups } of blocks) {
    const local = cellCenters(nodeGrid(groups))
    const radius = new Map(groups.map(g => [g.id, g.radius]))
    const xs = groups.flatMap(g => [local.get(g.id)!.x - g.radius, local.get(g.id)!.x + g.radius])
    const ys = groups.flatMap(g => [local.get(g.id)!.y - g.radius, local.get(g.id)!.y + g.radius])
    const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]
    const width = maxX - minX + 2 * FRAME_PAD
    const height = maxY - minY + 2 * FRAME_PAD + FRAME_HEAD
    const top = Math.round(-height / 2)
    for (const [id, c] of local) {
      if (radius.has(id)) centers.set(id, { x: Math.round(left + FRAME_PAD + c.x - minX), y: Math.round(top + FRAME_HEAD + FRAME_PAD + c.y - minY) })
    }
    const data: PveClusterData = { kind: 'pveCluster', cluster, width, height }
    frames.push({
      id: pveClusterId(cluster.id), type: 'pveCluster', position: { x: left, y: top }, width, height, zIndex: -1,
      focusable: false, selectable: false, style: { pointerEvents: 'none' }, data,
    })
    left += width + FRAME_GAP
  }
  return { frames, centers }
}

/** What a Proxmox node holds: its guests per zone (by zone name) and those in no zone. */
function shares(list: readonly Placed[]): { zones: PveZoneShare[]; unzoned: number } {
  const zones = new Map<string, PveZoneShare>()
  let unzoned = 0
  for (const { zone } of list) {
    if (!zone) { unzoned++; continue }
    const share = zones.get(zone.id) ?? { id: zone.id, name: zone.name, color: zone.color, count: 0 }
    share.count++
    zones.set(zone.id, share)
  }
  return { zones: [...zones.values()].sort((a, b) => byText(a.name, b.name) || byText(a.id, b.id)), unzoned }
}

/**
 * The node view: a circle per Proxmox node of the connection (`pveNodes`: an empty node too, with the count of every
 * guest it holds; without that list, the nodes of the guests of the map and their count), by name. Inside, the guests
 * of the map (the members of the zones and the running guests in no zone), each in the colour of its zone (11 and a
 * "+N" past 12, like a zone circle). The
 * pending observed flows whose two ends are known guests (resolved from their addresses) and the exceptions go from
 * the node of the source to the node of the destination, one edge per pair of nodes and kind, with the guest pairs
 * they stand for. What stays inside a node draws no edge: the circle counts its observed flows, per kind. The allowed flows
 * between zones are not drawn here (the Groups rendering shows them). On a shared policy (`clusters`) a node is one of
 * its cluster (two clusters may each have a "pve1"), the nodes of each cluster sit in a frame headed by its name, the
 * frames side by side, and a flow between nodes of two clusters is drawn like any other. Nothing while the guests are unknown. Pure and
 * deterministic.
 */
export function buildNodeView({ zones, suggestions, members = null, unzoned = null, unapplied = null, exceptions = null, pveNodes = null, clusters = null }: MapInput): ZoneGraph {
  if (!members) return { nodes: [], edges: [] }
  const shared = isSharedMap({ clusters })
  const sorted = [...zones].sort((a, b) => byText(a.name, b.name) || byText(a.id, b.id))
  const known = new Map(sorted.map(z => [z.id, z]))
  const guests = placedGuests(sorted, members, unzoned, shared)
  const book = addressBook(guests)

  // Each node circle, by id: its name, its cluster (shared policy), its guest count and status when the page knows them.
  // A guest whose node is not known cannot be placed.
  const clusterById = new Map((clusters ?? []).map(c => [c.id, c]))
  type NodeOf = { node: string; cluster?: MapCluster; total?: number; status?: string; list: Placed[] }
  const byNode = new Map<string, NodeOf>()
  for (const info of pveNodes ?? []) {
    if (!info.node) continue
    const cluster = shared && info.cluster ? clusterById.get(info.cluster) ?? { id: info.cluster, name: info.cluster } : undefined
    byNode.set(pveNodeId(info.node, cluster?.id), { node: info.node, cluster, total: info.guests, status: info.status || undefined, list: [] })
  }
  for (const p of guests.values()) {
    if (!p.member.node) continue
    const entry = byNode.get(p.pve) ?? { node: p.member.node, cluster: shared ? p.member.cluster : undefined, list: [] }
    entry.list.push(p)
    byNode.set(p.pve, entry)
  }

  const pairs = new Map<string, Pair>()
  const notes: PairNotes = new Map()
  const inside = new Map<string, PveNodeData['insideByKind']>()
  for (const s of [...suggestions].sort((a, b) => byText(a.id, b.id))) {
    if (s.status !== 'pending' || !known.has(s.dst_zone_id)) continue
    const source = book.get(bareIp(s.src_ip || ''))
    const target = book.get(bareIp(s.dst_ip || ''))
    if (!source?.member.node || !target?.member.node) continue
    const kind = s.kind === 'blocked' ? 'blocked' : 'unprotected'
    if (source.pve === target.pve) {
      const counts = inside.get(source.pve) ?? { unprotected: 0, blocked: 0 }
      counts[kind]++
      inside.set(source.pve, counts)
      continue
    }
    addPair(pairs, kind, source.pve, target.pve, flowService(s), undefined, s)
    note(notes, kind, source, target, flowService(s))
  }
  for (const link of exceptionLinks(exceptions, known, members, unzoned, shared)) {
    const source = guests.get(link.sourceKey)
    const target = guests.get(link.destinationKey)
    if (!source?.member.node || !target?.member.node || source.pve === target.pve) continue
    for (const service of link.exception.services) {
      addPair(pairs, 'exception', source.pve, target.pve, flowService(service), undefined, undefined, link.exception)
      note(notes, 'exception', source, target, flowService(service))
    }
  }
  const ordered = [...pairs.values()].sort(comparePairs)

  const groupFor = (id: string) => {
    const { node, cluster, total, status, list } = byNode.get(id)!
    const insideByKind = inside.get(id) ?? { unprotected: 0, blocked: 0 }
    const data: PveNodeData = {
      kind: 'pveNode', node, count: total ?? list.length, ...shares(list), inside: insideByKind.unprotected + insideByKind.blocked, insideByKind, radius: 0,
      ...(status ? { status } : {}), ...(cluster ? { cluster } : {}),
    }
    return groupOf(id, list.map(p => p.member), data)
  }
  const byNodeName = (a: string, b: string) => byText(byNode.get(a)!.node, byNode.get(b)!.node) || byText(a, b)
  const out: Placement = { nodes: [], obstacles: [], endShapes: new Map() }
  let frames: Placement['nodes'] = []
  if (shared) {
    // A frame per cluster, in the order of the clusters given, then any other cluster a node names.
    const order = [...(clusters ?? []).map(c => c.id)]
    for (const entry of byNode.values()) if (entry.cluster && !order.includes(entry.cluster.id)) order.push(entry.cluster.id)
    const blocks = order.flatMap(clusterId => {
      const ids = [...byNode.keys()].filter(id => byNode.get(id)!.cluster?.id === clusterId).sort(byNodeName)
      const cluster = byNode.get(ids[0] ?? '')?.cluster
      return cluster ? [{ cluster, groups: ids.map(groupFor) }] : []
    })
    const placed = placeBlocks(blocks)
    frames = placed.frames
    for (const block of blocks) for (const group of block.groups) placeGroup(out, group, placed.centers.get(group.id)!)
  } else {
    const groups = [...byNode.keys()].sort(byText).map(groupFor)
    const centers = cellCenters(nodeGrid(groups))
    for (const group of groups) placeGroup(out, group, centers.get(group.id)!)
  }

  // Each guest in the colour of its zone.
  const nodes: Node[] = [...frames, ...out.nodes.map(n => {
    const d = n.data as unknown as GuestNodeData
    if (d.kind !== 'guest') return n
    const zone = guests.get(d.member.key)?.zone ?? null
    const color = zone?.color || UNZONED_COLOR
    return { ...n, data: { ...d, color, zone: zone ? zone.name : null, inert: d.member.status !== 'running' } satisfies GuestNodeData }
  })]
  const edges = placePairs(ordered, out.endShapes, out.obstacles, unapplied).map(e => ({
    ...e, data: { ...(e.data as unknown as MapEdgeData), guestPairs: guestPairsOf(notes.get(e.id)) } satisfies MapEdgeData,
  }))
  return { nodes, edges }
}

/**
 * The node view with the flows inside each node counted for the kinds the flow checkboxes show (unprotected, blocked).
 * The edges are left as they are: `filterEdges` filters them.
 */
export function applyInsideFilters(graph: ZoneGraph, filters: FlowFilters): ZoneGraph {
  const nodes = graph.nodes.map(n => {
    const d = n.data as unknown as PveNodeData
    if (d.kind !== 'pveNode') return n
    const inside = (filters.unprotected ? d.insideByKind.unprotected : 0) + (filters.blocked ? d.insideByKind.blocked : 0)
    return inside === d.inside ? n : { ...n, data: { ...d, inside } satisfies PveNodeData }
  })
  return { nodes, edges: graph.edges }
}
