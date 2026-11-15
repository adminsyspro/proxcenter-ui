import type { Node } from '@xyflow/react'

import type { MicrosegZone } from '@/lib/microseg/types'

import { flowService } from './FlowSummary'
import {
  EDGE_COLORS, addPair, bareIp, cellCenters, comparePairs, exceptionLinks, groupOf, placeGroup, placePairs, pveNodeId,
  type Cell, type FlowFilters, type GuestNodeData, type GuestPair, type Group, type MapEdgeData, type MapEdgeKind, type MapInput, type MapMember, type Pair,
  type Placement, type PveNodeData, type PveZoneShare, type ZoneGraph,
} from './zoneGraph'
import { byText } from './zoneLayout'
import { guestKey } from './zoneModel'

/** The colour of a guest in no zone: the grey of what is outside the zones. */
export const UNZONED_COLOR = EDGE_COLORS.outside

/** A guest of the view: where it runs and the zone it belongs to (null: none). */
type Placed = { member: MapMember; zone: MicrosegZone | null }

const byName = (a: Placed, b: Placed) => byText(a.member.name, b.member.name) || byText(a.member.key, b.member.key)

/**
 * Every guest the map knows, once, by guest ("qemu/101"): the members of the zones, then the running guests in no
 * zone. A guest two zones hold (a change of zone that is queued) is of the first by name, as on the other renderings.
 */
function placedGuests(sorted: MicrosegZone[], members: ReadonlyMap<string, MapMember[]>, unzoned: MapInput['unzoned']): Map<string, Placed> {
  const guests = new Map<string, Placed>()
  for (const zone of sorted) {
    for (const member of members.get(zone.id) ?? []) if (!guests.has(guestKey(member))) guests.set(guestKey(member), { member, zone })
  }
  for (const member of unzoned ?? []) if (!guests.has(guestKey(member))) guests.set(guestKey(member), { member, zone: null })
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
  const id = `${kind}:${pveNodeId(source.member.node)}>${pveNodeId(target.member.node)}`
  const pairs = notes.get(id) ?? new Map<string, Note>()
  const key = `${guestKey(source.member)}>${guestKey(target.member)}`
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
 * between zones are not drawn here (the Groups rendering shows them). Nothing while the guests are unknown. Pure and
 * deterministic.
 */
export function buildNodeView({ zones, suggestions, members = null, unzoned = null, unapplied = null, exceptions = null, pveNodes = null }: MapInput): ZoneGraph {
  if (!members) return { nodes: [], edges: [] }
  const sorted = [...zones].sort((a, b) => byText(a.name, b.name) || byText(a.id, b.id))
  const known = new Map(sorted.map(z => [z.id, z]))
  const guests = placedGuests(sorted, members, unzoned)
  const book = addressBook(guests)

  // A guest whose node is not known cannot be placed.
  const byNode = new Map<string, Placed[]>()
  const total = new Map<string, number>()
  const statusOf = new Map<string, string>()
  for (const info of pveNodes ?? []) {
    if (!info.node) continue
    byNode.set(info.node, [])
    total.set(info.node, info.guests)
    if (info.status) statusOf.set(info.node, info.status)
  }
  for (const p of guests.values()) if (p.member.node) byNode.set(p.member.node, [...(byNode.get(p.member.node) ?? []), p])

  const pairs = new Map<string, Pair>()
  const notes: PairNotes = new Map()
  const inside = new Map<string, PveNodeData['insideByKind']>()
  for (const s of [...suggestions].sort((a, b) => byText(a.id, b.id))) {
    if (s.status !== 'pending' || !known.has(s.dst_zone_id)) continue
    const source = book.get(bareIp(s.src_ip || ''))
    const target = book.get(bareIp(s.dst_ip || ''))
    if (!source?.member.node || !target?.member.node) continue
    const kind = s.kind === 'blocked' ? 'blocked' : 'unprotected'
    if (source.member.node === target.member.node) {
      const counts = inside.get(source.member.node) ?? { unprotected: 0, blocked: 0 }
      counts[kind]++
      inside.set(source.member.node, counts)
      continue
    }
    addPair(pairs, kind, pveNodeId(source.member.node), pveNodeId(target.member.node), flowService(s), undefined, s)
    note(notes, kind, source, target, flowService(s))
  }
  for (const link of exceptionLinks(exceptions, known, members, unzoned)) {
    const source = guests.get(guestKey(link.source))
    const target = guests.get(guestKey(link.destination))
    if (!source?.member.node || !target?.member.node || source.member.node === target.member.node) continue
    for (const service of link.exception.services) {
      addPair(pairs, 'exception', pveNodeId(source.member.node), pveNodeId(target.member.node), flowService(service), undefined, undefined, link.exception)
      note(notes, 'exception', source, target, flowService(service))
    }
  }
  const ordered = [...pairs.values()].sort(comparePairs)

  const groups = [...byNode.keys()].sort(byText).map(node => {
    const list = byNode.get(node)!
    const insideByKind = inside.get(node) ?? { unprotected: 0, blocked: 0 }
    const data: PveNodeData = {
      kind: 'pveNode', node, count: total.get(node) ?? list.length, ...shares(list), inside: insideByKind.unprotected + insideByKind.blocked, insideByKind, radius: 0,
      ...(statusOf.has(node) ? { status: statusOf.get(node) } : {}),
    }
    return groupOf(pveNodeId(node), list.map(p => p.member), data)
  })
  const grid = nodeGrid(groups)
  const centers = cellCenters(grid)
  const out: Placement = { nodes: [], obstacles: [], endShapes: new Map() }
  for (const group of groups) placeGroup(out, group, centers.get(group.id)!)

  // Each guest in the colour of its zone.
  const nodes: Node[] = out.nodes.map(n => {
    const d = n.data as unknown as GuestNodeData
    if (d.kind !== 'guest') return n
    const zone = guests.get(guestKey(d.member))?.zone ?? null
    const color = zone?.color || UNZONED_COLOR
    return { ...n, data: { ...d, color, zone: zone ? zone.name : null, inert: d.member.status !== 'running' } satisfies GuestNodeData }
  })
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
