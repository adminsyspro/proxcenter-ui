import type { PolicyDiff } from '@/lib/microseg/pendingChanges'
import type { MicrosegFlow, MicrosegZone } from '@/lib/microseg/types'
import { serviceLabel } from '@/lib/network/serviceNames'

import { flowService } from './FlowSummary'
import { pairKey } from './useFlowHits'

/** Where a flow stands against the last applied revision; `unknown` while the revision is read. */
export type FlowState = 'applied' | 'pendingAdd' | 'pendingChange' | 'pendingRemoval' | 'notApplied' | 'unknown'

export type FlowHits =
  | { value: number }
  | { value: null; reason: 'cidrSource' | 'cidrDestination' | 'unavailable' | 'loading' }

export type FlowRowModel = { flow: MicrosegFlow; removed: boolean; state: FlowState; hits: FlowHits }

/** The flows into one destination: a zone (`zone`, removed from the draft or not), or the CIDR destinations (`zone` null). */
export type FlowGroup = { key: string; zone: MicrosegZone | null; zoneRemoved: boolean; rows: FlowRowModel[] }

export type FlowSort = 'source' | 'hits'

/** The group of the flows to a CIDR. */
export const OUTSIDE_GROUP = '__outside__'

/** A source CIDR that takes every address: the hits from no zone are all its own. */
const ANY_ADDRESS = new Set(['0.0.0.0/0', '::/0'])

/**
 * The state of a flow: removed first (it is gone from the draft), then not applied in v1 (a CIDR destination, whatever
 * its diff), then added or changed, applied otherwise. Without a diff (the revision is still read) it is unknown.
 */
export function flowState(flow: MicrosegFlow, diff: PolicyDiff | null): FlowState {
  const kind = diff?.flows.get(flow.id)
  if (kind === 'removed') return 'pendingRemoval'
  if (flow.dst_cidr) return 'notApplied'
  if (!diff) return 'unknown'
  if (kind === 'added') return 'pendingAdd'
  if (kind === 'changed') return 'pendingChange'
  return 'applied'
}

/**
 * The hits of the last 24 hours of a flow, by its zone pair: the history keeps the source and destination zones, not
 * the port. A source CIDR only takes the hits from no zone when it covers every address; a CIDR destination is not
 * applied in v1 and counts none.
 */
export function flowHits(flow: MicrosegFlow, zonesById: ReadonlyMap<string, MicrosegZone>, pairs: ReadonlyMap<string, number> | null, failed: boolean): FlowHits {
  if (flow.dst_cidr) return { value: null, reason: 'cidrDestination' }
  const dst = zonesById.get(flow.dst_zone_id)
  let src: string | null = null
  if (flow.src_zone_id) src = zonesById.get(flow.src_zone_id)?.name ?? null
  else if (ANY_ADDRESS.has(flow.src_cidr.trim())) src = ''
  if (src === null || !dst) return { value: null, reason: 'cidrSource' }
  if (!pairs) return { value: null, reason: failed ? 'unavailable' : 'loading' }
  return { value: pairs.get(pairKey(src, dst.name)) ?? 0 }
}

/** The text of one end of a flow: its zone's name, or its CIDR. */
export function endText(zoneId: string, cidr: string, zonesById: ReadonlyMap<string, MicrosegZone>): string {
  return cidr || zonesById.get(zoneId)?.name || zoneId
}

/** The filter keeps the flows whose source, destination or service holds the text, whatever the case. */
export function matchesFilter(flow: MicrosegFlow, zonesById: ReadonlyMap<string, MicrosegZone>, text: string): boolean {
  const needle = text.trim().toLowerCase()
  if (!needle) return true
  return [
    endText(flow.src_zone_id, flow.src_cidr, zonesById),
    endText(flow.dst_zone_id, flow.dst_cidr, zonesById),
    serviceLabel(flow.proto, flow.dport),
    flowService(flow),
  ].some(s => s.toLowerCase().includes(needle))
}

const hitsOf = (row: FlowRowModel) => (row.hits.value === null ? -1 : row.hits.value)

function compareRows(sort: FlowSort, zonesById: ReadonlyMap<string, MicrosegZone>) {
  const bySource = (a: FlowRowModel, b: FlowRowModel) =>
    endText(a.flow.src_zone_id, a.flow.src_cidr, zonesById).localeCompare(endText(b.flow.src_zone_id, b.flow.src_cidr, zonesById))
    || flowService(a.flow).localeCompare(flowService(b.flow))
  return sort === 'hits' ? (a: FlowRowModel, b: FlowRowModel) => hitsOf(b) - hitsOf(a) || bySource(a, b) : bySource
}

/**
 * The flows of the draft and those it removed, grouped by destination: the zones in the draft's order, then the zones
 * the draft removed, then the CIDR destinations. Only the groups the filter leaves a row in; rows sorted by source
 * (then service) or by hits (most first, no count last).
 */
export function flowGroups(input: {
  zones: readonly MicrosegZone[]
  flows: readonly MicrosegFlow[]
  diff: PolicyDiff | null
  pairs: ReadonlyMap<string, number> | null
  failed: boolean
  filter: string
  sort: FlowSort
}): FlowGroup[] {
  const { zones, flows, diff, pairs, failed, filter, sort } = input
  const removedZones = diff?.removedZones ?? []
  const zonesById = new Map([...removedZones, ...zones].map(z => [z.id, z]))
  const rows: FlowRowModel[] = [
    ...flows.map(flow => ({ flow, removed: false })),
    ...(diff?.removedFlows ?? []).map(flow => ({ flow, removed: true })),
  ]
    .filter(r => matchesFilter(r.flow, zonesById, filter))
    .map(r => ({ ...r, state: flowState(r.flow, diff), hits: flowHits(r.flow, zonesById, pairs, failed) }))

  const byKey = new Map<string, FlowRowModel[]>()
  for (const row of rows) {
    const key = row.flow.dst_cidr ? OUTSIDE_GROUP : row.flow.dst_zone_id
    byKey.set(key, [...(byKey.get(key) ?? []), row])
  }
  const order: FlowGroup[] = [
    ...zones.map(zone => ({ key: zone.id, zone, zoneRemoved: false })),
    ...removedZones.map(zone => ({ key: zone.id, zone, zoneRemoved: true })),
  ].map(g => ({ ...g, rows: byKey.get(g.key) ?? [] }))
  // A destination zone known nowhere (a stale id) still shows its flows, under its id.
  const known = new Set([...order.map(g => g.key), OUTSIDE_GROUP])
  for (const [key, list] of byKey) if (!known.has(key)) order.push({ key, zone: null, zoneRemoved: false, rows: list })
  order.push({ key: OUTSIDE_GROUP, zone: null, zoneRemoved: false, rows: byKey.get(OUTSIDE_GROUP) ?? [] })

  const compare = compareRows(sort, zonesById)
  return order.filter(g => g.rows.length > 0).map(g => ({ ...g, rows: [...g.rows].sort(compare) }))
}
