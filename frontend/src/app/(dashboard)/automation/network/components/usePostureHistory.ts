import { useMemo } from 'react'
import useSWR from 'swr'

import { MicrosegApiError, microsegApi, microsegBaseUrl } from '@/lib/microseg/api'
import type { MicrosegTraffic } from '@/lib/microseg/types'

import { TIMELINE_RANGES, historyWindow, stepMsOf, type TimelineRange } from './postureTimeline'
import { useNow } from './microseg/useNow'

/** The history gains a bucket every 5 minutes and the open one grows: a read per minute, as the events ring. */
export const HISTORY_REFRESH_MS = 60_000

/**
 * The persisted history of the flows (the engine's database, 7 days, no Proxmox call) for the Posture time chart,
 * over the range asked, in the steps of that range; `range` is the one the answer held belongs to. `connId` null reads nothing (a grouping that needs guest-level
 * events). The previous range stays on screen while the next one is read; a failure (an older orchestrator without
 * the route, a follower, an error) is not retried: the caller falls back to the events ring.
 */
export function usePostureHistory(connId: string | null, range: TimelineRange) {
  const now = useNow(HISTORY_REFRESH_MS)
  const span = useMemo(() => historyWindow(now, range), [now, range])
  const api = useMemo(() => (connId ? microsegApi(connId) : null), [connId])
  const stepSec = stepMsOf(range) / 1000
  const key = connId ? [`${microsegBaseUrl(connId)}/traffic`, span.from, span.to, stepSec] : null

  const { data, error } = useSWR<MicrosegTraffic, MicrosegApiError>(
    key,
    () => api!.getMicrosegTraffic({ from: new Date(span.from).toISOString(), to: new Date(span.to).toISOString(), step: stepSec }),
    { refreshInterval: HISTORY_REFRESH_MS, refreshWhenHidden: false, revalidateOnFocus: false, shouldRetryOnError: false, keepPreviousData: true },
  )
  // The answer on screen may be the previous range's (kept while the next is read): its own step says which.
  const shown = data ? (TIMELINE_RANGES.find(r => stepMsOf(r) / 1000 === data.step) ?? range) : range
  return { history: data, error, range: shown }
}
