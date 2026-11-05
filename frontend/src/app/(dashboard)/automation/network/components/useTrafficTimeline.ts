import { useCallback, useMemo } from 'react'

import type { MicrosegEvent, MicrosegZone } from '@/lib/microseg/types'

import { isZoneGrouping, type GroupBy, type PostureGuest } from './dashboardPosture'
import { loggedEnds, onPair, postureHistory, postureTimeline, type TimelineRange, type TimelineSeries, type TimelineVerdict, type TrafficPair } from './postureTimeline'
import { useNow } from './microseg/useNow'
import { usePostureEvents } from './usePostureEvents'
import { usePostureHistory } from './usePostureHistory'

const NO_HISTORY = { step: 0, from: '', to: '', buckets: [] }
const NO_GUESTS: readonly PostureGuest[] = []

/** Why the chart cannot follow the range: a grouping that needs guest-level events, or no history served. */
export type RangeLock = 'grouping' | 'unavailable' | null

/**
 * The traffic over time of the Posture Dashboard and of the map panels, one source choice for both: the persisted
 * history of the range when grouped by zone (the only grouping the history carries), the events of the orchestrator's
 * ring otherwise, when the history is not served, or for one guest (the history does not carry guests). `zone` keeps
 * one zone's flows: grouped by source zone, those it received (the history filtered on it, the ring asked with
 * `zone=`); grouped by destination zone, those it emitted (filtered here on the source zone); `keep` keeps some events
 * of the ring (a guest). No Proxmox call. `build` gives the same chart for another verdict (the panel's summary).
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
}) {
  const { connection, zones, slices, groupBy, verdict, range, guests = NO_GUESTS, addresses = false, zone = null, keep = null } = o
  const historyWanted = isZoneGrouping(groupBy) && !keep
  const history = usePostureHistory(historyWanted ? connection : null, range)
  // The ring (orchestrator memory) is read only when it is the source: no events read for a history that answered.
  const memory = !historyWanted || !!history.error
  // One zone, inbound (by source): the ring filters on the zone that logged them (`zone=`). Outbound (by destination):
  // the ring has no source zone filter, so it is read whole and the source zone is kept here.
  const outbound = groupBy === 'dstzone'
  const emitter = o.pair?.emitter ?? null
  const receiver = o.pair?.receiver ?? null
  // A pair: the ring asked with the zone that logged its flows (the receiver inbound, the emitter outbound).
  let ringZone = zone && !outbound ? zone.name : undefined
  if (emitter !== null && receiver !== null) ringZone = (outbound ? emitter : receiver) || undefined
  const ring = usePostureEvents(memory ? connection : null, ringZone)
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
  return { timeline, build, answer, rangeLock, now }
}
