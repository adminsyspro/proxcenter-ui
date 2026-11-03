import { buildCompactGraph } from './compactGraph'
import { buildGuestView } from './guestViewModel'
import type { MapView } from './MapToolbar'
import { buildZoneGraph, type MapInput, type ZoneGraph } from './zoneGraph'

const EMPTY: ZoneGraph = { nodes: [], edges: [] }

/**
 * The canvas graph of a rendering: Groups, Compact zones, or the guest view around `centre` (empty without one).
 * The matrix draws no canvas: its graph is empty.
 */
export function mapViewGraph(view: MapView, input: MapInput, centre: string | null): ZoneGraph {
  if (view === 'compact') return buildCompactGraph(input)
  if (view === 'guests') return centre ? buildGuestView({ ...input, centre }) : EMPTY
  if (view === 'matrix') return EMPTY
  return buildZoneGraph(input)
}
