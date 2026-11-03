import { useMemo, useRef } from 'react'
import useSWR from 'swr'

import { MicrosegApiError, microsegApi, microsegBaseUrl } from '@/lib/microseg/api'
import { FATAL_CODES } from '@/lib/microseg/useMicroseg'
import { EVENTS_REFRESH_MS } from '@/lib/microseg/useMicrosegEvents'
import type { MicrosegEvent } from '@/lib/microseg/types'

import { EVENTS_PAGE, EVENTS_PAGES, mergeEvents } from './postureTimeline'

type Api = ReturnType<typeof microsegApi>

/** Up to EVENTS_PAGES pages of the ring, newest first, each one below the previous by `before_seq`. */
async function readWindow(api: Api): Promise<MicrosegEvent[]> {
  let events: MicrosegEvent[] = []
  for (let page = 0; page < EVENTS_PAGES; page++) {
    const last = events.at(-1)
    const res = await api.getMicrosegEvents(last ? { limit: EVENTS_PAGE, before_seq: last.seq } : { limit: EVENTS_PAGE })
    events = [...events, ...res.events]
    if (res.events.length < EVENTS_PAGE) break
  }
  return events
}

/**
 * The events of the orchestrator's ring for the Posture time chart (no Proxmox call): up to 2000 on the first read
 * (4 pages of 500), then every minute while the Dashboard shows, only the newest page put on top of what is held
 * (the whole window again when more came in than a page holds). SWR pauses the refresh while the tab is hidden.
 */
export function usePostureEvents(connId: string | null) {
  const api = useMemo(() => (connId ? microsegApi(connId) : null), [connId])
  const held = useRef<{ conn: string | null; events: MicrosegEvent[] }>({ conn: null, events: [] })
  const key = connId ? [`${microsegBaseUrl(connId)}/events`, 'posture', EVENTS_PAGE * EVENTS_PAGES] : null

  const { data, error } = useSWR<MicrosegEvent[], MicrosegApiError>(
    key,
    async () => {
      const mine = held.current.conn === connId ? held.current.events : []
      let events: MicrosegEvent[] | null = null
      if (mine.length) events = mergeEvents(mine, (await api!.getMicrosegEvents({ limit: EVENTS_PAGE })).events)
      events ??= await readWindow(api!)
      held.current = { conn: connId, events }
      return events
    },
    {
      refreshInterval: EVENTS_REFRESH_MS,
      refreshWhenHidden: false,
      revalidateOnFocus: false,
      dedupingInterval: 5000,
      shouldRetryOnError: (e: MicrosegApiError) => !FATAL_CODES.has(e?.code),
    },
  )
  return { events: data, error }
}
