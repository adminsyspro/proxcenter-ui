import { useCallback, useMemo } from 'react'

import type { MicrosegEvent, MicrosegZone } from '@/lib/microseg/types'

import { mergeClusterEvents, mergeHistories, pendingClusters } from './dashboardAggregate'
import { isZoneGrouping, type GroupBy, type PostureGuest } from './dashboardPosture'
import { loggedEnds, onPair, postureHistory, postureTimeline, type TimelineRange, type TimelineSeries, type TimelineVerdict, type TrafficPair } from './postureTimeline'
import { useNow } from './microseg/useNow'
import { usePolicyEvents, usePolicyHistory } from './usePolicyReads'

const NO_HISTORY = { step: 0, from: '', to: '', buckets: [] }
const NO_GUESTS: readonly PostureGuest[] = []
const NO_IDS: string[] = []

/** Why the chart cannot follow the range: a grouping that needs guest-level events, or no history served. */
export type RangeLock = 'grouping' | 'unavailable' | null

/**
 * The traffic over time of the Posture Dashboard and of the map panels, one source choice for both: the persisted
 * history of the range when grouped by zone (the only grouping the history carries), the events of the orchestrator's
 * ring otherwise, when the history is not served, or for one guest (the history does not carry guests). `zone` keeps
 * one zone's flows: grouped by source zone, those it received (the history filtered on it, the ring asked with
 * `zone=`); grouped by destination zone, those it emitted (filtered here on the source zone); `keep` keeps some events
 * of the ring (a guest). No Proxmox call. `build` gives the same chart for another verdict (the panel's summary).
 *
 * `clusters` (the Dashboard of a shared policy): the history or the ring of each of them, read through its own relay
 * and merged; `shown` draws some of them only (the strip's filter) out of what was read, without another read. The
 * ring is the source when the history of every cluster failed. `missing`: the clusters whose read failed. `pending`: a
 * drawn cluster's read has not answered yet, so the merged chart would be a partial sum (never drawn as the total).
 */
export function useTrafficTimeline(o: {
  connection: string | null
  zones: readonly MicrosegZone[]
  slices: readonly TimelineSeries[]
  groupBy: GroupBy
  verdict: TimelineVerdict
  range: TimelineRange
  guests?: readonly PostureGuest[]
  addresses?: boolean
  zone?: MicrosegZone | null
  /** One pair of zones instead of a zone: grouped by source, what the receiver logged; by destination, what the emitter logged. */
  pair?: TrafficPair | null
  keep?: ((e: MicrosegEvent) => boolean) | null
  /** The clusters of a shared policy, the connection first: each one read, merged. Absent: the connection alone. */
  clusters?: readonly string[]
  /** The clusters drawn among `clusters` (absent: all of them). */
  shown?: readonly string[]
}) {
  const { connection, zones, slices, groupBy, verdict, range, guests = NO_GUESTS, addresses = false, zone = null, keep = null } = o
  const ids = o.clusters ?? (connection ? [connection] : NO_IDS)
  const drawn = o.shown ?? ids
  const tagged = !!o.clusters && o.clusters.length > 1
  const historyWanted = isZoneGrouping(groupBy) && !keep
  const histories = usePolicyHistory(historyWanted ? ids : NO_IDS, range)
  // The ring (orchestrator memory) is read only when it is the source: no events read for a history that answered.
  // On a shared policy it is the source once the history of every cluster failed (an orchestrator without the route).
  const memory = !historyWanted || (ids.length > 0 && ids.every(id => id in histories.errors))
  // One zone, inbound (by source): the ring filters on the zone that logged them (`zone=`). Outbound (by destination):
  // the ring has no source zone filter, so it is read whole and the source zone is kept here.
  const outbound = groupBy === 'dstzone'
  const emitter = o.pair?.emitter ?? null
  const receiver = o.pair?.receiver ?? null
  // A pair: the ring asked with the zone that logged its flows (the receiver inbound, the emitter outbound).
  let ringZone = zone && !outbound ? zone.name : undefined
  if (emitter !== null && receiver !== null) ringZone = (outbound ? emitter : receiver) || undefined
  const rings = usePolicyEvents(memory ? ids : NO_IDS, ringZone)
  const drawnKey = drawn.join('|')
  const history = useMemo(() => ({
    history: mergeHistories(drawnKey.split('|').map(id => histories.byCluster[id])),
    range: histories.range,
  }), [histories, drawnKey])
  const ring = useMemo(() => {
    const keys = drawnKey.split('|')
    const events = mergeClusterEvents(keys.map(id => ({ cluster: id, events: rings.byCluster[id] })), tagged)
    const failed = keys.map(id => rings.errors[id]).filter(e => e != null)
    return { events, error: failed.length === keys.length ? failed[0] : undefined }
  }, [rings, drawnKey, tagged])
  const pending = tagged && pendingClusters(drawn, memory ? rings : histories).length > 0
  const missing = useMemo(() => Object.keys(memory ? rings.errors : histories.errors), [memory, rings.errors, histories.errors])
  const zoneName = zone?.name.toLowerCase() ?? null
  const pair = useMemo<TrafficPair | null>(() => (emitter === null || receiver === null ? null : { emitter, receiver }), [emitter, receiver])
  const kept = useMemo(() => {
    if (pair) return (e: MicrosegEvent) => onPair(pair, outbound ? 'out' : 'in', e) && (!keep || keep(e))
    if (!outbound || zoneName === null) return keep
    return (e: MicrosegEvent) => loggedEnds(e).emitter.toLowerCase() === zoneName && (!keep || keep(e))
  }, [pair, outbound, zoneName, keep])
  // A minute clock: the last bucket follows the time.
  const now = useNow(60_000, ring.events)

  const build = useCallback((v: TimelineVerdict) => (memory
    ? postureTimeline({ events: ring.events ?? [], groupBy, verdict: v, zones, guests, addresses, slices, now, keep: kept })
    : postureHistory({ history: history.history ?? NO_HISTORY, range: history.range, verdict: v, zones, slices, zone: zone?.name, pair, by: outbound ? 'dst' : 'src' })),
  [memory, ring.events, history.history, history.range, groupBy, zones, guests, addresses, slices, now, kept, zone, pair, outbound])
  const timeline = useMemo(() => build(verdict), [build, verdict])

  const answer = memory ? { data: ring.events, error: ring.error } : { data: history.history, error: undefined }
  let rangeLock: RangeLock = null
  if (!isZoneGrouping(groupBy)) rangeLock = 'grouping'
  else if (memory) rangeLock = 'unavailable'
  return { timeline, build, answer, rangeLock, now, missing, pending }
}
