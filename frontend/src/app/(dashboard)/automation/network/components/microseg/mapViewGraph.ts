import { buildCompactGraph } from './compactGraph'
import { buildGuestView, buildZoneInside } from './guestViewModel'
import type { MapView } from './MapToolbar'
import { buildNodeView } from './nodeViewModel'
import { buildZoneGraph, type MapInput, type ZoneGraph } from './zoneGraph'

const EMPTY: ZoneGraph = { nodes: [], edges: [] }

/** What the map shows: a rendering of the toolbar, or the inside of a zone that was entered. */
export type ShownView = MapView | 'inside'

/**
 * The canvas graph of a rendering: Groups, Compact zones, the guest view around `centre` (empty without one), or the
 * guests on their Proxmox nodes; or the inside of the zone `centre`. `externalAddresses` false folds the addresses in
 * no zone of the two views centred on a zone into their Unknown / External box.
 * The matrix and the Sankey diagram draw no canvas: their graph is empty.
 */
export function mapViewGraph(view: ShownView, input: MapInput, centre: string | null, externalAddresses = true): ZoneGraph {
  if (view === 'inside') return centre ? buildZoneInside({ ...input, centre, externalAddresses }) : EMPTY
  if (view === 'compact') return buildCompactGraph(input)
  if (view === 'guests') return centre ? buildGuestView({ ...input, centre, externalAddresses }) : EMPTY
  if (view === 'nodes') return buildNodeView(input)
  if (view === 'matrix' || view === 'sankey') return EMPTY
  return buildZoneGraph(input)
}
