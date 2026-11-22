import { useMemo } from 'react'
import useSWR from 'swr'

import { MicrosegApiError, microsegApi, microsegBaseUrl } from '@/lib/microseg/api'
import type { MicrosegVolume } from '@/lib/microseg/types'

import { HISTORY_REFRESH_MS } from './usePostureHistory'
import { TIMELINE_RANGES, historyWindow, stepMsOf, type TimelineRange } from './postureTimeline'
import { useNow } from './microseg/useNow'

/**
 * The sFlow volume between the zones over the range, in the steps of the history route (the orchestrator's database,
 * 7 days, no Proxmox call), the services of each pair summed. Same window, steps and pace as `usePostureHistory`, so
 * the Volume tab and the events chart line up. `connId` null reads nothing. `range` is the one the answer held
 * belongs to (the previous range stays on screen while the next one is read).
 */
export function useVolumeHistory(connId: string | null, range: TimelineRange) {
  const now = useNow(HISTORY_REFRESH_MS)
  const span = useMemo(() => historyWindow(now, range), [now, range])
  const api = useMemo(() => (connId ? microsegApi(connId) : null), [connId])
  const stepSec = stepMsOf(range) / 1000
  const key = connId ? [`${microsegBaseUrl(connId)}/volume`, span.from, span.to, stepSec] : null

  const { data, error } = useSWR<MicrosegVolume, MicrosegApiError>(
    key,
    () => api!.getMicrosegVolume({ from: new Date(span.from).toISOString(), to: new Date(span.to).toISOString(), step: stepSec, group: 'pair' }),
    { refreshInterval: HISTORY_REFRESH_MS, refreshWhenHidden: false, revalidateOnFocus: false, shouldRetryOnError: false, keepPreviousData: true },
  )
  const shown = data ? (TIMELINE_RANGES.find(r => stepMsOf(r) / 1000 === data.step) ?? range) : range
  return { volume: data, error, range: shown }
}
