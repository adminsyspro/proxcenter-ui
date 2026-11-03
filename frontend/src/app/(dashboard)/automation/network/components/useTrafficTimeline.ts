import { useCallback, useMemo } from 'react'

import type { MicrosegEvent, MicrosegZone } from '@/lib/microseg/types'

import type { GroupBy, PostureGuest } from './dashboardPosture'
import { postureHistory, postureTimeline, type TimelineRange, type TimelineSeries, type TimelineVerdict } from './postureTimeline'
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
 * the flows logged in that zone (the history filtered on it, the ring asked with `zone=`); `keep` keeps some events of
 * the ring (a guest). No Proxmox call. `build` gives the same chart for another verdict (the panel's summary).
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
  keep?: ((e: MicrosegEvent) => boolean) | null
}) {
  const { connection, zones, slices, groupBy, verdict, range, guests = NO_GUESTS, addresses = false, zone = null, keep = null } = o
  const historyWanted = groupBy === 'zone' && !keep
  const history = usePostureHistory(historyWanted ? connection : null, range)
  // The ring (orchestrator memory) is read only when it is the source: no events read for a history that answered.
  const memory = !historyWanted || !!history.error
  const ring = usePostureEvents(memory ? connection : null, zone?.name)
  // A minute clock: the last bucket follows the time.
  const now = useNow(60_000, ring.events)

  const build = useCallback((v: TimelineVerdict) => (memory
    ? postureTimeline({ events: ring.events ?? [], groupBy, verdict: v, zones, guests, addresses, slices, now, keep })
    : postureHistory({ history: history.history ?? NO_HISTORY, range: history.range, verdict: v, zones, slices, zone: zone?.name })),
  [memory, ring.events, history.history, history.range, groupBy, zones, guests, addresses, slices, now, keep, zone])
  const timeline = useMemo(() => build(verdict), [build, verdict])

  const answer = memory ? { data: ring.events, error: ring.error } : { data: history.history, error: undefined }
  let rangeLock: RangeLock = null
  if (groupBy !== 'zone') rangeLock = 'grouping'
  else if (memory) rangeLock = 'unavailable'
  return { timeline, build, answer, rangeLock, now }
}
