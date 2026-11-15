import { buildCompactGraph } from './compactGraph'
import { buildGuestView } from './guestViewModel'
import type { MapView } from './MapToolbar'
import { buildNodeView } from './nodeViewModel'
import { buildZoneGraph, type MapInput, type ZoneGraph } from './zoneGraph'

const EMPTY: ZoneGraph = { nodes: [], edges: [] }

/**
 * The canvas graph of a rendering: Groups, Compact zones, the guest view around `centre` (empty without one), or the
 * guests on their Proxmox nodes.
 * The matrix and the Sankey diagram draw no canvas: their graph is empty.
 */
export function mapViewGraph(view: MapView, input: MapInput, centre: string | null): ZoneGraph {
  if (view === 'compact') return buildCompactGraph(input)
  if (view === 'guests') return centre ? buildGuestView({ ...input, centre }) : EMPTY
  if (view === 'nodes') return buildNodeView(input)
  if (view === 'matrix' || view === 'sankey') return EMPTY
  return buildZoneGraph(input)
}
