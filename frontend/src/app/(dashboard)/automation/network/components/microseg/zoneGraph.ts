import { MarkerType, type Edge, type Node } from '@xyflow/react'

import type { MicrosegFlow, MicrosegSuggestion, MicrosegZone, ZoneState } from '@/lib/microseg/types'

import { crossesBox, edgeGeometry, type Point } from './edgeGeometry'
import { flowService } from './FlowSummary'

/** Size of every node of the map: one line. The edges clip their ends on it. */
export const NODE_W = 200
export const NODE_H = 44

/** Gap between two parallel edges of the same pair of nodes: the label of an edge is about 22 px high. */
const LANE_GAP = 28
/** Room kept between an edge end and its box, and between an edge and the boxes it must not touch. */
const EDGE_GAP = 4
const CLEARANCE = 6
/** The bows tried for the edges of a pair, as a part of the distance between the two nodes: straight first. */
const BOWS = [0, 0.2, -0.2, 0.4, -0.4, 0.6, -0.6, 0.8, -0.8]
/** Room between the ring of zones and the External / Outside nodes. */
const SIDE_GAP = 120

export const EXTERNAL_ID = 'external'
export const OUTSIDE_ID = 'outside'
export const zoneNodeId = (zoneId: string) => `zone:${zoneId}`

export const EDGE_COLORS = { pending: '#f44336', outside: '#9e9e9e', flow: '#4caf50' } as const

export type ZoneNodeData = {
  kind: 'zone'
  zone: MicrosegZone
  /** Null while the guests of the connection are not known. */
  members: number | null
  state: ZoneState
}

export type BoundaryNodeData = { kind: 'external' | 'outside' }

export type MapEdgeKind = 'flow' | 'pending' | 'outside'

export type MapEdgeData = {
  kind: MapEdgeKind
  /** protocol/ports tokens of the flows (or suggestions) the edge stands for, sorted. */
  services: string[]
  /** How many flows (or suggestions) it stands for. */
  count: number
  /** Shift along the normal of the edge, so parallel edges of a pair do not overlap. */
  offset: number
  /** How far the middle of the edge bows along the same normal, to stay clear of the other nodes (0: straight). */
  bow: number
  /** Where the label sits along the edge (0 to 1), staggered between the edges of a pair. */
  labelAt: number
  /** Only an allowed flow carries the animated particle. */
  particle: boolean
  color: string
}

type Pair = { source: string; target: string; kind: MapEdgeKind; services: Set<string>; count: number }

const KIND_RANK: Record<MapEdgeKind, number> = { flow: 0, pending: 1, outside: 2 }
const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/**
 * Zones on an ellipse, clockwise from the top, sorted by name, the ring turned by half a step so that no zone sits
 * on its horizontal axis. External is above left and Outside below right, off that axis too.
 */
function layout(zones: MicrosegZone[], withExternal: boolean, withOutside: boolean) {
  const n = zones.length
  const rx = Math.max(280, n * 45)
  const ry = Math.round(rx * 0.55)
  const spot = (cx: number, cy: number) => ({ x: Math.round(cx - NODE_W / 2), y: Math.round(cy - NODE_H / 2) })
  const positions = new Map<string, { x: number; y: number }>()
  zones.forEach((z, i) => {
    if (n === 1) {
      positions.set(z.id, spot(0, 0))
      return
    }
    const angle = -Math.PI / 2 + Math.PI / n + (2 * Math.PI * i) / n
    positions.set(z.id, spot(rx * Math.cos(angle), ry * Math.sin(angle)))
  })
  const side = rx + NODE_W + SIDE_GAP
  const rise = Math.round(ry * 0.6)
  return {
    zone: (id: string) => positions.get(id)!,
    external: withExternal ? spot(-side, -rise) : null,
    outside: withOutside ? spot(side, rise) : null,
  }
}

function edgeStyle(kind: MapEdgeKind, color: string): Edge['style'] {
  return kind === 'flow'
    ? { stroke: color, strokeWidth: 2 }
    : { stroke: color, strokeWidth: 2, strokeDasharray: '6 4' }
}

/**
 * The map of the draft: a node per zone, an External node for the sources that
 * are in no zone (a CIDR, an unknown IP), an Outside node for the CIDR
 * destinations (not applied in v1), a solid edge per pair of nodes with at
 * least one flow, a dashed red one per pair with pending would-block
 * suggestions, a dashed grey one to Outside. Pure and deterministic: the same
 * input gives the same graph, whatever the order of the lists.
 *
 * `memberCounts` maps a zone id to its member count; without it the counts are
 * unknown (null).
 */
export function buildZoneGraph(
  zones: MicrosegZone[],
  flows: MicrosegFlow[],
  suggestions: MicrosegSuggestion[],
  memberCounts?: ReadonlyMap<string, number> | null,
): { nodes: Node[]; edges: Edge[] } {
  const sorted = [...zones].sort((a, b) => byText(a.name, b.name) || byText(a.id, b.id))
  const known = new Map(sorted.map(z => [z.id, z]))
  const pairs = new Map<string, Pair>()

  const add = (kind: MapEdgeKind, source: string, target: string, service: string) => {
    if (source === target) return
    const key = `${kind}|${source}>${target}`
    const pair = pairs.get(key) ?? { source, target, kind, services: new Set<string>(), count: 0 }
    pair.services.add(service)
    pair.count += 1
    pairs.set(key, pair)
  }

  for (const f of flows) {
    const source = f.src_cidr ? EXTERNAL_ID : known.has(f.src_zone_id) ? zoneNodeId(f.src_zone_id) : null
    const target = f.dst_cidr ? OUTSIDE_ID : known.has(f.dst_zone_id) ? zoneNodeId(f.dst_zone_id) : null
    if (!source || !target || (source === EXTERNAL_ID && target === OUTSIDE_ID)) continue
    add(target === OUTSIDE_ID ? 'outside' : 'flow', source, target, flowService(f))
  }
  for (const s of suggestions) {
    if (s.kind !== 'would_block' || s.status !== 'pending' || !known.has(s.dst_zone_id)) continue
    add('pending', known.has(s.src_zone_id) ? zoneNodeId(s.src_zone_id) : EXTERNAL_ID, zoneNodeId(s.dst_zone_id), flowService(s))
  }

  const ordered = [...pairs.values()].sort((a, b) => (
    byText(a.source, b.source) || byText(a.target, b.target) || KIND_RANK[a.kind] - KIND_RANK[b.kind]
  ))
  const hasExternal = ordered.some(p => p.source === EXTERNAL_ID)
  const hasOutside = ordered.some(p => p.target === OUTSIDE_ID)
  const places = layout(sorted, hasExternal, hasOutside)

  const nodes: Node[] = sorted.map(z => ({
    id: zoneNodeId(z.id),
    type: 'zone',
    position: places.zone(z.id),
    width: NODE_W,
    height: NODE_H,
    // The zone button inside the node takes the focus and the keys: the wrapper of the library has no action of its own.
    focusable: false,
    data: { kind: 'zone', zone: z, members: memberCounts ? (memberCounts.get(z.id) ?? 0) : null, state: z.state } satisfies ZoneNodeData,
  }))
  if (places.external) {
    nodes.push({ id: EXTERNAL_ID, type: 'boundary', position: places.external, width: NODE_W, height: NODE_H, focusable: false, data: { kind: 'external' } satisfies BoundaryNodeData })
  }
  if (places.outside) {
    nodes.push({ id: OUTSIDE_ID, type: 'boundary', position: places.outside, width: NODE_W, height: NODE_H, focusable: false, data: { kind: 'outside' } satisfies BoundaryNodeData })
  }

  // Lanes: the edges between the same two nodes keep side by side. Each direction drives on its own side of the
  // pair (the offset is along the normal of the edge, which flips with the direction), and the edges of one
  // direction spread around the middle line when the other direction is empty. Their labels sit at different places
  // along the edge too: 0.4 of the way from the source for the two directions (so 0.4 and 0.6 on the pair), then
  // 0.6 for the second edge of a direction.
  const lanes = new Map<string, Pair[]>()
  for (const p of ordered) {
    const key = `${p.source}>${p.target}`
    lanes.set(key, [...(lanes.get(key) ?? []), p])
  }
  const lane = (p: Pair) => {
    const same = lanes.get(`${p.source}>${p.target}`)!
    const k = same.indexOf(p)
    const hasReverse = lanes.has(`${p.target}>${p.source}`)
    const offset = (hasReverse ? k + 0.5 : k - (same.length - 1) / 2) * LANE_GAP
    const labelAt = !hasReverse && same.length === 1 ? 0.5 : 0.4 + 0.2 * (k % 2)
    return { offset, labelAt }
  }

  const centers = new Map<string, Point>(nodes.map(n => [n.id, { x: n.position.x + NODE_W / 2, y: n.position.y + NODE_H / 2 }]))
  const bows = chooseBows(ordered, lane, centers)

  const edges: Edge[] = ordered.map(p => {
    const sourceZone = p.kind === 'pending' || p.kind === 'flow' ? known.get(p.source.replace(/^zone:/, '')) : undefined
    const color = p.kind === 'flow' ? (sourceZone?.color || EDGE_COLORS.flow) : EDGE_COLORS[p.kind]
    const { offset, labelAt } = lane(p)
    return {
      id: `${p.kind}:${p.source}>${p.target}`,
      type: 'flow',
      source: p.source,
      target: p.target,
      // The map is read with the pointer or with the zone buttons: the edges take no focus (the panel lists the flows).
      focusable: false,
      style: edgeStyle(p.kind, color),
      markerEnd: { type: MarkerType.ArrowClosed, color, width: 16, height: 16 },
      data: {
        kind: p.kind, services: [...p.services].sort(byText), count: p.count, offset, labelAt, bow: bows.get(p) ?? 0,
        particle: p.kind === 'flow', color,
      } satisfies MapEdgeData,
    }
  })

  return { nodes, edges }
}

/**
 * The bow of every edge: for each pair of nodes the first bow of BOWS (straight first) with which none of its edges
 * (with their lane) enters an unrelated node. The bow is chosen once per pair in the frame of the lesser node, so that
 * the two directions follow the same curve; with no clear bow the one that touches the fewest nodes is kept.
 */
function chooseBows(
  ordered: Pair[],
  lane: (p: Pair) => { offset: number; labelAt: number },
  centers: Map<string, Point>,
): Map<Pair, number> {
  const groups = new Map<string, Pair[]>()
  for (const p of ordered) {
    const key = p.source < p.target ? `${p.source}|${p.target}` : `${p.target}|${p.source}`
    groups.set(key, [...(groups.get(key) ?? []), p])
  }
  const result = new Map<Pair, number>()
  for (const [key, group] of groups) {
    const [first] = key.split('|')
    const [a, b] = [centers.get(group[0].source)!, centers.get(group[0].target)!]
    const reach = Math.hypot(b.x - a.x, b.y - a.y)
    const bowOf = (p: Pair, canonical: number) => (p.source === first ? canonical : -canonical) * reach
    let best = { canonical: 0, hits: Infinity }
    for (const canonical of BOWS) {
      let hits = 0
      for (const p of group) {
        const { offset, labelAt } = lane(p)
        const shape = edgeGeometry(centers.get(p.source)!, centers.get(p.target)!, {
          halfW: NODE_W / 2, halfH: NODE_H / 2, gap: EDGE_GAP, offset, bow: bowOf(p, canonical), at: labelAt,
        })
        if (!shape) continue
        for (const [id, center] of centers) {
          if (id !== p.source && id !== p.target && crossesBox(shape.points, center, NODE_W / 2, NODE_H / 2, CLEARANCE)) hits++
        }
      }
      if (hits < best.hits) best = { canonical, hits }
      if (hits === 0) break
    }
    for (const p of group) result.set(p, bowOf(p, best.canonical))
  }
  return result
}
