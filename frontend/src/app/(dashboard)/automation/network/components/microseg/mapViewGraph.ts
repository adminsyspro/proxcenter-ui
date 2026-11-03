import { buildCompactGraph } from './compactGraph'
import type { MapView } from './MapToolbar'
import { buildZoneGraph, type MapInput, type ZoneGraph } from './zoneGraph'

/**
 * The canvas graph of a rendering: Groups or Compact zones.
 */
export function mapViewGraph(view: MapView, input: MapInput): ZoneGraph {
  if (view === 'compact') return buildCompactGraph(input)
  return buildZoneGraph(input)
}
