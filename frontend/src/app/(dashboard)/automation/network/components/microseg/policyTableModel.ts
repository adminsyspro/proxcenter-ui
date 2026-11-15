import type { PolicyDiff } from '@/lib/microseg/pendingChanges'
import type { MicrosegFlow, MicrosegZone } from '@/lib/microseg/types'
import { serviceLabel } from '@/lib/network/serviceNames'

import { flowService } from './FlowSummary'

/** Where a flow stands against the last applied revision; `unknown` while the revision is read. */
export type FlowState = 'applied' | 'pendingAdd' | 'pendingChange' | 'pendingRemoval' | 'notApplied' | 'unknown'

export type FlowRowModel = { flow: MicrosegFlow; removed: boolean; state: FlowState }

/** The flows into one destination: a zone (`zone`, removed from the draft or not), or the CIDR destinations (`zone` null). */
export type FlowGroup = { key: string; zone: MicrosegZone | null; zoneRemoved: boolean; rows: FlowRowModel[] }

/** The group of the flows to a CIDR. */
export const OUTSIDE_GROUP = '__outside__'

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

/** By source (zone name or CIDR), then service. */
function bySource(zonesById: ReadonlyMap<string, MicrosegZone>) {
  return (a: FlowRowModel, b: FlowRowModel) =>
    endText(a.flow.src_zone_id, a.flow.src_cidr, zonesById).localeCompare(endText(b.flow.src_zone_id, b.flow.src_cidr, zonesById))
    || flowService(a.flow).localeCompare(flowService(b.flow))
}

/**
 * The flows of the draft and those it removed, grouped by destination: the zones in the draft's order, then the zones
 * the draft removed, then the CIDR destinations. Without a filter every zone of the draft keeps its group, even with
 * no flow into it (its header still says how much traffic no flow covers); with one, only the groups it leaves a row
 * in. Rows sorted by source, then service.
 */
export function flowGroups(input: {
  zones: readonly MicrosegZone[]
  flows: readonly MicrosegFlow[]
  diff: PolicyDiff | null
  filter: string
}): FlowGroup[] {
  const { zones, flows, diff, filter } = input
  const removedZones = diff?.removedZones ?? []
  const zonesById = new Map([...removedZones, ...zones].map(z => [z.id, z]))
  const rows: FlowRowModel[] = [
    ...flows.map(flow => ({ flow, removed: false })),
    ...(diff?.removedFlows ?? []).map(flow => ({ flow, removed: true })),
  ]
    .filter(r => matchesFilter(r.flow, zonesById, filter))
    .map(r => ({ ...r, state: flowState(r.flow, diff) }))

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

  const compare = bySource(zonesById)
  const filtering = filter.trim() !== ''
  return order
    .filter(g => g.rows.length > 0 || (!filtering && !!g.zone && !g.zoneRemoved))
    .map(g => ({ ...g, rows: [...g.rows].sort(compare) }))
}
