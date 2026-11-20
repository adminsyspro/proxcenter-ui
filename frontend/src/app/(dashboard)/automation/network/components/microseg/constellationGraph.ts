import type { MicrosegSuggestion, MicrosegZone } from '@/lib/microseg/types'

import { placeBox } from './compactGraph'
import { flowService } from './FlowSummary'
import {
  EXTERNAL_ID, OUTSIDE_ID, UNZONED_ID, addAllowedPairs, addExceptionZonePairs, addPair, bareIp, comparePairs, exceptionLinks, isSharedMap, outsideEgressOf, placeBoundary, placePairs,
  zoneColumns, zoneNodeId, type MapEdgeKind, type MapInput, type MapMember, type Pair, type Placement, type UnzonedNodeData, type ZoneGraph,
} from './zoneGraph'

/** The nodes are placed by the constellation itself: the graph only spaces them out, for the helpers it shares with the other renderings. */
const SPACING = 400

/**
 * The pending observed flows into a known zone, zone to zone: a source in no zone comes from the guests in no zone
 * when its address is one of theirs, from Unknown / External otherwise.
 */
function addObservedPairs(pairs: Map<string, Pair>, suggestions: MicrosegSuggestion[], known: ReadonlyMap<string, MicrosegZone>, unzonedIps: ReadonlySet<string>) {
  for (const s of suggestions) {
    if (s.status !== 'pending' || !known.has(s.dst_zone_id)) continue
    const kind: MapEdgeKind = s.kind === 'blocked' ? 'blocked' : 'unprotected'
    let source = EXTERNAL_ID
    if (known.has(s.src_zone_id)) source = zoneNodeId(s.src_zone_id)
    else if (unzonedIps.has(bareIp(s.src_ip || ''))) source = UNZONED_ID
    addPair(pairs, kind, source, zoneNodeId(s.dst_zone_id), flowService(s), undefined, s)
  }
}

const ipsOf = (members: readonly MapMember[]) => new Set(members.flatMap(m => m.ips.map(bareIp)))

/**
 * The graph of the constellation: a node per zone (name, state, member count), one for the running guests in no zone
 * when there are some, Unknown / External and Outside when an edge needs them. Every flow goes from node to node: one
 * green edge per ordered pair of zones with its ports grouped and the count of the exceptions between them, the
 * observed flows (unprotected, blocked) as their own edges. The same data as the compact rendering, read from the same
 * input: no request of its own. Pure and deterministic.
 */
export function buildConstellationGraph({ zones, flows, suggestions, members = null, unzoned = null, unapplied = null, exceptions = null, clusters = null }: MapInput): ZoneGraph {
  const { sorted, known } = zoneColumns(zones, flows)
  const unzonedList = members && unzoned && unzoned.length > 0 ? unzoned : null
  const pairs = new Map<string, Pair>()
  addAllowedPairs(pairs, flows, known)
  addExceptionZonePairs(pairs, exceptionLinks(exceptions, known, members, unzoned, isSharedMap({ clusters })))
  addObservedPairs(pairs, suggestions, known, ipsOf(unzonedList ?? []))
  const ordered = [...pairs.values()].sort(comparePairs)

  const out: Placement = { nodes: [], obstacles: [], endShapes: new Map() }
  let column = 0
  const next = () => ({ x: column++ * SPACING, y: 0 })
  for (const zone of sorted) {
    const inside = suggestions.filter(s => s.status === 'pending' && s.src_zone_id === zone.id && s.dst_zone_id === zone.id).length
    placeBox(out, zone, members ? (members.get(zone.id)?.length ?? 0) : null, inside, next())
  }
  if (unzonedList) {
    const c = next()
    out.nodes.push({ id: UNZONED_ID, type: 'unzoned', position: c, focusable: false, data: { kind: 'unzoned', count: unzonedList.length, radius: 0 } satisfies UnzonedNodeData })
    out.endShapes.set(UNZONED_ID, { center: c, shape: { kind: 'circle', r: 1 }, group: UNZONED_ID })
  }
  const outsideEgress = outsideEgressOf(flows, known)
  if (ordered.some(p => p.source === EXTERNAL_ID)) placeBoundary(out, EXTERNAL_ID, next())
  if (ordered.some(p => p.target === OUTSIDE_ID)) placeBoundary(out, OUTSIDE_ID, next(), outsideEgress)

  // No obstacle: the arcs are drawn on the sphere, the path the helper computes is not used.
  return { nodes: out.nodes, edges: placePairs(ordered, out.endShapes, [], unapplied) }
}
