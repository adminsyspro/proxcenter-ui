import type { MicrosegSuggestion, MicrosegZone } from '@/lib/microseg/types'

import { cellView, type MatrixModel } from './matrixModel'
import {
  UNZONED_ID, bareIp, guestNodeId, moreNodeId, zoneNodeId, type FlowFilters, type MapEdgeData, type ZoneGraph,
} from './zoneGraph'
import { byText } from './zoneLayout'
import { guestKey, type PolicyGuest, type ZoneMember } from './zoneModel'

/** The most guests the target picker lists for one search: typing narrows it. */
export const MAX_OPTIONS = 50

/** A running guest the map can be focused on, with the zone it belongs to (null: in no zone). */
export type TargetGuest = {
  key: string
  vmid: number
  name: string
  type: 'qemu' | 'lxc'
  node: string
  status: string
  ips: string[]
  zoneId: string | null
}

/** The zone of each guest: the one it is tagged with, else the one it is queued for. */
function zoneOfGuests(membersByZone: ReadonlyMap<string, ZoneMember[]>): Map<string, string> {
  const tagged = new Map<string, string>()
  const queued = new Map<string, string>()
  for (const [zoneId, members] of membersByZone) {
    for (const m of members) {
      const into = m.pending ? queued : tagged
      const key = guestKey(m.ref)
      if (!into.has(key)) into.set(key, zoneId)
    }
  }
  return new Map([...queued, ...tagged])
}

/** The running guests of the connection, by name, each with its zone. Pure. */
export function targetCandidates(guests: PolicyGuest[], membersByZone: ReadonlyMap<string, ZoneMember[]>): TargetGuest[] {
  const zoneOf = zoneOfGuests(membersByZone)
  return guests
    .filter(g => g.status === 'running')
    .map(g => ({ key: guestKey(g), vmid: g.vmid, name: g.name, type: g.type, node: g.node, status: g.status, ips: g.ips ?? [], zoneId: zoneOf.get(guestKey(g)) ?? null }))
    .sort((a, b) => byText(a.name, b.name) || a.vmid - b.vmid)
}

/** A guest matches a search on its name (anywhere), its VMID or one of its addresses (from the start), any case. */
export function matchesTarget(t: TargetGuest, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  if (t.name.toLowerCase().includes(q) || String(t.vmid).startsWith(q)) return true
  return t.ips.some(ip => ip.toLowerCase().startsWith(q) || bareIp(ip).startsWith(q))
}

/** The options of the picker for a search, in their order, at most MAX_OPTIONS. */
export function filterTargets(candidates: TargetGuest[], query: string): TargetGuest[] {
  return candidates.filter(c => matchesTarget(c, query)).slice(0, MAX_OPTIONS)
}

/** The addresses of a guest in their canonical form: read once per guest, then matched against many flows. */
export const targetAddresses = (t: Pick<TargetGuest, 'ips'>): ReadonlySet<string> => new Set(t.ips.map(ip => bareIp(ip)).filter(Boolean))

/** An observed flow whose sample source or destination address is one of `ips` (see targetAddresses). */
export function involvesAddresses(s: Pick<MicrosegSuggestion, 'src_ip' | 'dst_ip'>, ips: ReadonlySet<string>): boolean {
  return [s.src_ip, s.dst_ip].some(ip => !!ip && ips.has(bareIp(ip)))
}

/** An observed flow whose sample source or destination address is one of the guest's. */
export function involvesTarget(s: Pick<MicrosegSuggestion, 'src_ip' | 'dst_ip'>, t: Pick<TargetGuest, 'ips'>): boolean {
  return involvesAddresses(s, targetAddresses(t))
}

export type TargetFlow = { suggestion: MicrosegSuggestion; direction: 'in' | 'out'; peerIp: string }

/** The pending observed flows of the guest: outgoing when it is the source, else incoming; busiest first. */
export function targetSuggestions(suggestions: MicrosegSuggestion[], t: TargetGuest): TargetFlow[] {
  const ips = targetAddresses(t)
  const own = (ip: string) => !!ip && ips.has(bareIp(ip))
  return suggestions
    .filter(s => s.status === 'pending' && (own(s.src_ip) || own(s.dst_ip)))
    .map(s => (own(s.src_ip) ? { suggestion: s, direction: 'out' as const, peerIp: s.dst_ip } : { suggestion: s, direction: 'in' as const, peerIp: s.src_ip }))
    .sort((a, b) => b.suggestion.hits - a.suggestion.hits || Number(a.direction === 'in') - Number(b.direction === 'in') || byText(a.suggestion.id, b.suggestion.id))
}

/** The guest name of each known address (the first guest by name when two share one). */
export function targetPeers(guests: PolicyGuest[]): Map<string, string> {
  const peers = new Map<string, string>()
  for (const g of [...guests].sort((a, b) => byText(a.name, b.name))) {
    for (const ip of g.ips ?? []) if (!peers.has(bareIp(ip))) peers.set(bareIp(ip), g.name)
  }
  return peers
}

/** The node of the guest on a canvas: its glyph, else the "+N" of its circle, else the circle (or box) of its zone. */
export function targetNodeId(graph: ZoneGraph, t: TargetGuest): string | null {
  const ids = new Set(graph.nodes.map(n => n.id))
  const group = t.zoneId ?? UNZONED_ID
  const tries = [guestNodeId(group, t.key), moreNodeId(group), t.zoneId ? zoneNodeId(t.zoneId) : null]
  return tries.find(id => !!id && ids.has(id)) ?? null
}

export type TargetFocus = {
  /** The node of the guest (null when the canvas does not draw it). */
  node: string | null
  nodes: Set<string>
  edges: Set<string>
  /** The top-level nodes the view fits to: the zone of the guest and its neighbours. */
  fit: string[]
}

/**
 * The focus a targeted guest locks on a canvas: its node, the observed edges whose flows it is the sample source or
 * destination of, the allowed edges of its zone (in and out), and their ends. Null without a target, and when the
 * canvas draws nothing of it (the guest view centred on an unrelated zone): the map is then not dimmed. Pure.
 */
export function targetFocus(graph: ZoneGraph, t: TargetGuest | null): TargetFocus | null {
  if (!t) return null
  const parent = new Map(graph.nodes.map(n => [n.id, n.parentId]))
  const top = (id: string) => parent.get(id) ?? id
  const node = targetNodeId(graph, t)
  const zone = t.zoneId ? zoneNodeId(t.zoneId) : null
  const nodes = new Set<string>()
  const fit = new Set<string>()
  const light = (id: string) => {
    nodes.add(id)
    const p = parent.get(id)
    if (p) nodes.add(p)
    fit.add(top(id))
  }
  if (node) light(node)
  const ips = targetAddresses(t)
  const edges = new Set<string>()
  for (const e of graph.edges) {
    const d = e.data as unknown as MapEdgeData
    const allowed = d.kind === 'allowed' || d.kind === 'outside'
    const own = allowed ? !!zone && (e.source === zone || e.target === zone) : d.observed.some(s => involvesAddresses(s, ips))
    if (!own) continue
    edges.add(e.id)
    light(e.source)
    light(e.target)
  }
  if (!nodes.size) return null
  return { node, nodes, edges, fit: [...fit] }
}

/** The observed ribbons of the Sankey diagram (`${kind}:${cell}`) whose flows the guest is the sample end of. */
export function targetRibbons(model: MatrixModel, filters: FlowFilters, t: TargetGuest): Set<string> {
  const out = new Set<string>()
  const ips = targetAddresses(t)
  for (const cell of model.cells.values()) {
    const view = cellView(cell, filters, null)
    for (const s of view?.observed ?? []) {
      if (involvesAddresses(s, ips)) out.add(`${s.kind === 'blocked' ? 'blocked' : 'unprotected'}:${cell.id}`)
    }
  }
  return out
}

/** The Sankey diagram of a target: the node id of its zone and its ribbons. */
export function targetSankey(model: MatrixModel, filters: FlowFilters, t: TargetGuest): { zone: string | null; ribbons: Set<string> } {
  return { zone: t.zoneId ? zoneNodeId(t.zoneId) : null, ribbons: targetRibbons(model, filters, t) }
}

/** The colour of the ring of a targeted guest: its zone's ('' for the theme's primary colour). */
export function targetRing(t: TargetGuest | null, zonesById: ReadonlyMap<string, MicrosegZone>): string {
  return (t?.zoneId ? zonesById.get(t.zoneId)?.color : undefined) ?? ''
}
