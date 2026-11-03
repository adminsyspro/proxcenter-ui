import { useMemo } from 'react'
import useSWR from 'swr'

import { MicrosegApiError, microsegApi, microsegBaseUrl } from '@/lib/microseg/api'
import type { MicrosegTraffic } from '@/lib/microseg/types'

const HOUR_MS = 3_600_000

/** The Policy sub-tab reads the last 24 hours once, again every 5 minutes. */
export const UNCOVERED_REFRESH_MS = 300_000

/** The 24 hours that end with the current hour, in hour steps: 24 buckets, the last one still growing. */
export function hitsWindow(now: number): { from: number; to: number } {
  const to = Math.floor(now / HOUR_MS) * HOUR_MS + HOUR_MS
  return { from: to - 24 * HOUR_MS, to }
}

/**
 * The hits of the window per zone that logged them (the destination), by name whatever the case, every source,
 * verdict and bucket together. The history only holds logged events, would-block and blocked: the traffic into the
 * zone that no flow covers (a flow's allowed traffic is never logged).
 */
export function uncoveredByZone(traffic: Pick<MicrosegTraffic, 'buckets'>): Map<string, number> {
  const zones = new Map<string, number>()
  for (const b of traffic.buckets) {
    const key = b.zone.toLowerCase()
    zones.set(key, (zones.get(key) ?? 0) + b.hits)
  }
  return zones
}

/**
 * The uncovered traffic of the last 24 hours per destination zone, from the persisted history (the engine's database,
 * no Proxmox call): ONE read for the whole tab, refreshed every 5 minutes while the page is visible. A failure (an
 * older orchestrator, a follower) is not retried: the table shows no count.
 */
export function useZoneUncovered(connId: string | null): { byZone: Map<string, number> | null; failed: boolean } {
  const api = useMemo(() => (connId ? microsegApi(connId) : null), [connId])
  const key = connId ? [`${microsegBaseUrl(connId)}/traffic`, 'zone-uncovered-24h'] : null
  const { data, error } = useSWR<MicrosegTraffic, MicrosegApiError>(
    key,
    () => {
      const { from, to } = hitsWindow(Date.now())
      return api!.getMicrosegTraffic({ from: new Date(from).toISOString(), to: new Date(to).toISOString(), step: HOUR_MS / 1000 })
    },
    { refreshInterval: UNCOVERED_REFRESH_MS, refreshWhenHidden: false, revalidateOnFocus: false, shouldRetryOnError: false },
  )
  const byZone = useMemo(() => (data ? uncoveredByZone(data) : null), [data])
  return { byZone, failed: !!error && !data }
}
