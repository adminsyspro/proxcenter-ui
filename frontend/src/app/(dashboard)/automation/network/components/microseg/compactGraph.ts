import type { Node } from '@xyflow/react'

import type { MicrosegSuggestion, MicrosegZone } from '@/lib/microseg/types'

import { flowService } from './FlowSummary'
import {
  EXTERNAL_ID, NODE_H, NODE_W, OUTSIDE_ID, addAllowedPairs, addPair, cellCenters, comparePairs, placeBoundary, placePairs,
  zoneColumns, zoneNodeId, type Cell, type MapEdgeKind, type MapInput, type Pair, type Placement, type ZoneGraph, type ZoneNodeData,
} from './zoneGraph'

/** The box of a zone: its name on the first line, its state and member count on the second. */
export const BOX_W = 190
export const BOX_H = 64

const boxShape = { kind: 'box' as const, halfW: BOX_W / 2, halfH: BOX_H / 2 }
/** Boxes are smaller than circles: closer columns and rows keep the map readable when it fits the view. */
const COMPACT_COL_GAP = 130
const COMPACT_ROW_GAP = 56

/** The pending observed flows into a known zone, zone to zone (a source in no zone comes from External). */
function addObservedZonePairs(pairs: Map<string, Pair>, suggestions: MicrosegSuggestion[], known: ReadonlyMap<string, MicrosegZone>) {
  for (const s of suggestions) {
    if (s.status !== 'pending' || !known.has(s.dst_zone_id)) continue
    const kind: MapEdgeKind = s.kind === 'blocked' ? 'blocked' : 'unprotected'
    const source = known.has(s.src_zone_id) ? zoneNodeId(s.src_zone_id) : EXTERNAL_ID
    addPair(pairs, kind, source, zoneNodeId(s.dst_zone_id), flowService(s), undefined, s)
  }
}

/** Column 0 holds External, the zone columns follow, Outside is last. */
function boxGrid(columns: string[][], hasExternal: boolean, hasOutside: boolean): Cell[][] {
  const grid: Cell[][] = []
  if (hasExternal) grid.push([{ id: EXTERNAL_ID, w: NODE_W, h: NODE_H }])
  for (const column of columns.slice(1)) {
    if (column.length) grid.push(column.map(id => ({ id: zoneNodeId(id), w: BOX_W, h: BOX_H })))
  }
  if (hasOutside) grid.push([{ id: OUTSIDE_ID, w: NODE_W, h: NODE_H }])
  return grid
}

function placeBox(out: Placement, zone: MicrosegZone, members: number | null, c: { x: number; y: number }) {
  const id = zoneNodeId(zone.id)
  const data: ZoneNodeData = { kind: 'zone', zone, members, state: zone.state, radius: 0 }
  out.nodes.push({ id, type: 'zoneBox', position: { x: c.x - BOX_W / 2, y: c.y - BOX_H / 2 }, width: BOX_W, height: BOX_H, focusable: false, data })
  out.obstacles.push({ id, center: c, shape: boxShape })
  out.endShapes.set(id, { center: c, shape: boxShape, group: id })
}

/**
 * The compact rendering, for 10 to 40 zones: a box per zone (name, state, member count) instead of a circle of
 * guests, on the same grid as the groups view (longest-path layer as the column, barycenter order as the row). One
 * green edge per ordered pair of zones with its ports grouped, the observed flows (unprotected, blocked) as their own
 * edges zone to zone, External and Outside boxes when an edge needs them. Pure and deterministic.
 */
export function buildCompactGraph({ zones, flows, suggestions, members = null, unapplied = null }: MapInput): ZoneGraph {
  const { known, columns } = zoneColumns(zones, flows)
  const pairs = new Map<string, Pair>()
  addAllowedPairs(pairs, flows, known)
  addObservedZonePairs(pairs, suggestions, known)
  const ordered = [...pairs.values()].sort(comparePairs)

  const grid = boxGrid(columns, ordered.some(p => p.source === EXTERNAL_ID), ordered.some(p => p.target === OUTSIDE_ID))
  const centers = cellCenters(grid, COMPACT_COL_GAP, COMPACT_ROW_GAP)

  const out: Placement = { nodes: [] as Node[], obstacles: [], endShapes: new Map() }
  for (const cell of grid.flat()) {
    const c = centers.get(cell.id)!
    const zone = known.get(cell.id.replace(/^zone:/, ''))
    if (zone && cell.id.startsWith('zone:')) placeBox(out, zone, members ? (members.get(zone.id)?.length ?? 0) : null, c)
    else placeBoundary(out, cell.id, c)
  }

  return { nodes: out.nodes, edges: placePairs(ordered, out.endShapes, out.obstacles, unapplied) }
}
