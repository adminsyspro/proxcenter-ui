import { useMemo } from 'react'
import useSWR from 'swr'

import { MicrosegApiError, microsegApi, microsegBaseUrl } from '@/lib/microseg/api'
import { FATAL_CODES } from '@/lib/microseg/useMicroseg'
import { EVENTS_REFRESH_MS } from '@/lib/microseg/useMicrosegEvents'
import type { MicrosegEvent } from '@/lib/microseg/types'

import { EVENTS_PAGE, EVENTS_PAGES, mergeEvents } from './postureTimeline'

type Api = ReturnType<typeof microsegApi>

/** Up to EVENTS_PAGES pages of the ring, newest first, each one below the previous by `before_seq`. */
async function readWindow(api: Api, zone: string | undefined): Promise<MicrosegEvent[]> {
  let events: MicrosegEvent[] = []
  for (let page = 0; page < EVENTS_PAGES; page++) {
    const last = events.at(-1)
    const res = await api.getMicrosegEvents(last ? { limit: EVENTS_PAGE, before_seq: last.seq, zone } : { limit: EVENTS_PAGE, zone })
    events = [...events, ...res.events]
    if (res.events.length < EVENTS_PAGE) break
  }
  return events
}

/**
 * The events held per connection and zone filter, at the module level: a panel that mounts again (another guest picked,
 * the Dashboard opened again) reads only the newest page on top of them, never the 4 pages again. A few keys at most.
 */
const HELD = new Map<string, MicrosegEvent[]>()
const MAX_HELD = 16

function hold(stamp: string, events: MicrosegEvent[]) {
  HELD.delete(stamp)
  HELD.set(stamp, events)
  if (HELD.size > MAX_HELD) HELD.delete(HELD.keys().next().value as string)
}

/** Test hook: forget what is held. */
export function forgetHeldEvents() {
  HELD.clear()
}

/**
 * The events of the orchestrator's ring for the Posture time chart (no Proxmox call): up to 2000 on the first read
 * (4 pages of 500), then every minute while the Dashboard shows, only the newest page put on top of what is held
 * (the whole window again when more came in than a page holds). SWR pauses the refresh while the tab is hidden.
 * `zone` (a zone name): only the events logged in that zone, filtered by the orchestrator (the zone panel of the map).
 */
export function usePostureEvents(connId: string | null, zone?: string) {
  const api = useMemo(() => (connId ? microsegApi(connId) : null), [connId])
  const stamp = `${connId}|${zone ?? ''}`
  const key = connId ? [`${microsegBaseUrl(connId)}/events`, 'posture', EVENTS_PAGE * EVENTS_PAGES, zone ?? ''] : null

  const { data, error } = useSWR<MicrosegEvent[], MicrosegApiError>(
    key,
    async () => {
      const mine = HELD.get(stamp) ?? []
      let events: MicrosegEvent[] | null = null
      if (mine.length) events = mergeEvents(mine, (await api!.getMicrosegEvents({ limit: EVENTS_PAGE, zone })).events)
      events ??= await readWindow(api!, zone)
      hold(stamp, events)
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
