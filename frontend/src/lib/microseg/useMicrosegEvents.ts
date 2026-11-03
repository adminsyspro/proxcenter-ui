// src/lib/microseg/useMicrosegEvents.ts

import { useCallback, useMemo, useRef, useState } from 'react'
import useSWR from 'swr'

import { MicrosegApiError, microsegApi, microsegBaseUrl } from './api'
import { FATAL_CODES } from './useMicroseg'
import type { MicrosegEvent, MicrosegEventList, SuggestionKind } from './types'

/** The ring is filled from the nodes' logs once a minute, so a faster read would only repeat itself. */
export const EVENTS_REFRESH_MS = 60_000
/** Events per read. */
export const EVENTS_LIMIT = 200

export type EventFilters = { zone: string; verdict: '' | SuggestionKind; q: string }

/** What the list shows: the newest page, plus the older pages the user asked for. */
type Accumulated = {
  key: string
  rows: MicrosegEvent[]
  /** Older pages were loaded below the newest one. */
  loadedOlder: boolean
  /** The last page read was full or truncated: older events may exist. */
  more: boolean
  truncated: boolean
  /** Moves on every reset to a fresh page: a Load older started before it no longer applies. */
  epoch: number
}

type Stamped = MicrosegEventList & { stamp: string }

const isMore = (list: MicrosegEventList) => list.truncated || list.events.length >= EVENTS_LIMIT

/**
 * A refresh replaces the newest page. The older pages loaded below it stay, minus what the new page now covers, as
 * long as the new page reaches down to them. When more events came in than one page holds (its oldest is above the
 * newest one shown plus one), the lines in between were never read: the list starts again from the new page rather
 * than show a gap as if nothing happened there.
 */
export function mergeFresh(prev: Accumulated | null, stamp: string, fresh: MicrosegEventList): Accumulated {
  const epoch = prev?.epoch ?? 0
  if (prev?.key === stamp && prev.loadedOlder && fresh.events.length > 0) {
    const cut = fresh.events.at(-1)?.seq ?? Infinity
    const newestShown = prev.rows[0]?.seq ?? -Infinity
    if (cut <= newestShown + 1) {
      return {
        key: stamp,
        rows: [...fresh.events, ...prev.rows.filter(e => e.seq < cut)],
        loadedOlder: true,
        more: prev.more,
        truncated: prev.truncated,
        epoch,
      }
    }
  }
  return { key: stamp, rows: fresh.events, loadedOlder: false, more: isMore(fresh), truncated: fresh.truncated, epoch: epoch + 1 }
}

/**
 * GET /events of a connection: the flows the engine saw towards zone guests, from the orchestrator's memory (no
 * Proxmox call). One SWR key per filter set; `enabled` false reads nothing and stops the refresh. SWR pauses the
 * refresh while the tab is hidden.
 */
export function useMicrosegEvents(connId: string | null | undefined, filters: EventFilters, enabled = true) {
  const api = useMemo(() => (connId ? microsegApi(connId) : null), [connId])
  const { zone, verdict, q } = filters
  const stamp = `${connId}|${zone}|${verdict}|${q}`
  const key = connId && enabled ? [`${microsegBaseUrl(connId)}/events`, zone, verdict, q, EVENTS_LIMIT] : null

  const [acc, setAcc] = useState<Accumulated | null>(null)
  const [olderBusy, setOlderBusy] = useState(false)
  const [olderError, setOlderError] = useState<unknown>(null)
  const busy = useRef(false)

  const { data, error, isLoading, isValidating, mutate } = useSWR<Stamped, MicrosegApiError>(
    key,
    async () => ({ ...(await api!.getMicrosegEvents({ limit: EVENTS_LIMIT, zone, verdict: verdict || undefined, q })), stamp }),
    {
      refreshInterval: EVENTS_REFRESH_MS,
      refreshWhenHidden: false,
      revalidateOnFocus: false,
      dedupingInterval: 5000,
      shouldRetryOnError: (e: MicrosegApiError) => !FATAL_CODES.has(e?.code),
      onSuccess: res => setAcc(prev => mergeFresh(prev, res.stamp, res)),
    },
  )

  const current = acc?.key === stamp ? acc : null
  const fresh = data?.stamp === stamp ? data : null
  const events = useMemo(() => current?.rows ?? fresh?.events ?? [], [current, fresh])
  let more = false
  if (current) more = current.more
  else if (fresh) more = isMore(fresh)
  const truncated = current ? current.truncated : fresh?.truncated ?? false

  const loadOlder = useCallback(async () => {
    const last = events.at(-1)
    if (!api || !last || busy.current) return
    // The list this page goes below: if a refresh started it again meanwhile, the page no longer follows it.
    const startedOn = acc?.key === stamp ? acc.epoch : null
    busy.current = true
    setOlderBusy(true)
    setOlderError(null)
    try {
      const res = await api.getMicrosegEvents({ limit: EVENTS_LIMIT, before_seq: last.seq, zone, verdict: verdict || undefined, q })
      setAcc(prev => {
        const same = prev?.key === stamp
        if (startedOn !== null && (!same || prev.epoch !== startedOn)) return prev
        const base = same ? prev : { key: stamp, rows: events, loadedOlder: false, more, truncated, epoch: 0 }
        return { key: stamp, rows: [...base.rows, ...res.events], loadedOlder: true, more: isMore(res), truncated: res.truncated, epoch: base.epoch }
      })
    } catch (e) {
      setOlderError(e)
    } finally {
      busy.current = false
      setOlderBusy(false)
    }
  }, [api, acc, events, zone, verdict, q, stamp, more, truncated])

  return {
    events,
    more,
    truncated,
    loading: isLoading,
    validating: isValidating,
    error,
    olderError,
    olderBusy,
    loadOlder,
    reload: () => mutate(),
  }
}
