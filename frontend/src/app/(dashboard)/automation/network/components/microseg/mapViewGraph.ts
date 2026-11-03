import { buildCompactGraph } from './compactGraph'
import type { MapView } from './MapToolbar'
import { buildZoneGraph, type MapInput, type ZoneGraph } from './zoneGraph'

const EMPTY: ZoneGraph = { nodes: [], edges: [] }

/**
 * The canvas graph of a rendering: Groups or Compact zones.
 * The matrix draws no canvas: its graph is empty.
 */
export function mapViewGraph(view: MapView, input: MapInput): ZoneGraph {
  if (view === 'compact') return buildCompactGraph(input)
  if (view === 'matrix') return EMPTY
  return buildZoneGraph(input)
}
