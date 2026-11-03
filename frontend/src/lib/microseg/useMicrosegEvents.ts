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
}

type Stamped = MicrosegEventList & { stamp: string }

const isMore = (list: MicrosegEventList) => list.truncated || list.events.length >= EVENTS_LIMIT

/**
 * A refresh replaces the newest page. The older pages loaded below it stay, minus what the new page now covers, and the
 * events between the two pages are the ones of the page it replaces: nothing falls in a gap.
 */
export function mergeFresh(prev: Accumulated | null, stamp: string, fresh: MicrosegEventList): Accumulated {
  if (prev && prev.key === stamp && prev.loadedOlder && fresh.truncated && fresh.events.length > 0) {
    const cut = fresh.events[fresh.events.length - 1]?.seq ?? Infinity
    return {
      key: stamp,
      rows: [...fresh.events, ...prev.rows.filter(e => e.seq < cut)],
      loadedOlder: true,
      more: prev.more,
      truncated: prev.truncated,
    }
  }
  return { key: stamp, rows: fresh.events, loadedOlder: false, more: isMore(fresh), truncated: fresh.truncated }
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
  const more = current ? current.more : fresh ? isMore(fresh) : false
  const truncated = current ? current.truncated : fresh?.truncated ?? false

  const loadOlder = useCallback(async () => {
    const last = events[events.length - 1]
    if (!api || !last || busy.current) return
    busy.current = true
    setOlderBusy(true)
    setOlderError(null)
    try {
      const res = await api.getMicrosegEvents({ limit: EVENTS_LIMIT, before_seq: last.seq, zone, verdict: verdict || undefined, q })
      setAcc(prev => {
        const base = prev?.key === stamp ? prev : { key: stamp, rows: events, loadedOlder: false, more, truncated }
        return { key: stamp, rows: [...base.rows, ...res.events], loadedOlder: true, more: isMore(res), truncated: res.truncated }
      })
    } catch (e) {
      setOlderError(e)
    } finally {
      busy.current = false
      setOlderBusy(false)
    }
  }, [api, events, zone, verdict, q, stamp, more, truncated])

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
