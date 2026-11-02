import type { Edge, Node } from '@xyflow/react'

import type { MicrosegFlow, MicrosegSuggestion, MicrosegZone, ZoneState } from '@/lib/microseg/types'

import { flowService } from './FlowSummary'

/** Size of every node of the map: one line. The edges clip their ends on it. */
export const NODE_W = 200
export const NODE_H = 44

/** Gap between two parallel edges of the same pair of nodes. */
const LANE_GAP = 14
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
  /** Only an allowed flow carries the animated particle. */
  particle: boolean
  color: string
}

type Pair = { source: string; target: string; kind: MapEdgeKind; services: Set<string>; count: number }

const KIND_RANK: Record<MapEdgeKind, number> = { flow: 0, pending: 1, outside: 2 }
const byText = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/** Zones on an ellipse, clockwise from the top, sorted by name; External on the left, Outside on the right. */
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
    const angle = -Math.PI / 2 + (2 * Math.PI * i) / n
    positions.set(z.id, spot(rx * Math.cos(angle), ry * Math.sin(angle)))
  })
  const side = rx + NODE_W + SIDE_GAP
  return {
    zone: (id: string) => positions.get(id)!,
    external: withExternal ? spot(-side, 0) : null,
    outside: withOutside ? spot(side, 0) : null,
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
    data: { kind: 'zone', zone: z, members: memberCounts ? (memberCounts.get(z.id) ?? 0) : null, state: z.state } satisfies ZoneNodeData,
  }))
  if (places.external) {
    nodes.push({ id: EXTERNAL_ID, type: 'boundary', position: places.external, width: NODE_W, height: NODE_H, data: { kind: 'external' } satisfies BoundaryNodeData })
  }
  if (places.outside) {
    nodes.push({ id: OUTSIDE_ID, type: 'boundary', position: places.outside, width: NODE_W, height: NODE_H, data: { kind: 'outside' } satisfies BoundaryNodeData })
  }

  // Lanes: the edges between the same two nodes keep side by side. Each direction drives on its own side of the
  // pair (the offset is along the normal of the edge, which flips with the direction), and the edges of one
  // direction spread around the middle line when the other direction is empty.
  const lanes = new Map<string, Pair[]>()
  for (const p of ordered) {
    const key = `${p.source}>${p.target}`
    lanes.set(key, [...(lanes.get(key) ?? []), p])
  }
  const offsetOf = (p: Pair) => {
    const same = lanes.get(`${p.source}>${p.target}`)!
    const k = same.indexOf(p)
    const hasReverse = lanes.has(`${p.target}>${p.source}`)
    return (hasReverse ? k + 0.5 : k - (same.length - 1) / 2) * LANE_GAP
  }

  const edges: Edge[] = ordered.map(p => {
    const sourceZone = p.kind === 'pending' || p.kind === 'flow' ? known.get(p.source.replace(/^zone:/, '')) : undefined
    const color = p.kind === 'flow' ? (sourceZone?.color || EDGE_COLORS.flow) : EDGE_COLORS[p.kind]
    return {
      id: `${p.kind}:${p.source}>${p.target}`,
      type: 'flow',
      source: p.source,
      target: p.target,
      style: edgeStyle(p.kind, color),
      markerEnd: { type: 'arrowclosed' as never, color, width: 16, height: 16 },
      data: { kind: p.kind, services: [...p.services].sort(byText), count: p.count, offset: offsetOf(p), particle: p.kind === 'flow', color } satisfies MapEdgeData,
    }
  })

  return { nodes, edges }
}
