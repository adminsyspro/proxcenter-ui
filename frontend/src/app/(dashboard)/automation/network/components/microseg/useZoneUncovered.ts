import { useMemo } from 'react'
import useSWR from 'swr'

import { MicrosegApiError, microsegApi, microsegBaseUrl } from '@/lib/microseg/api'
import type { MicrosegTraffic } from '@/lib/microseg/types'

const HOUR_MS = 3_600_000

/** The table of the Policy sub-tab reads the last 24 hours once, again every 5 minutes. */
export const FLOW_HITS_REFRESH_MS = 300_000

/** The 24 hours that end with the current hour, in hour steps: 24 buckets, the last one still growing. */
export function hitsWindow(now: number): { from: number; to: number } {
  const to = Math.floor(now / HOUR_MS) * HOUR_MS + HOUR_MS
  return { from: to - 24 * HOUR_MS, to }
}

/** The key of a (source zone, destination zone) pair, by name whatever the case; "" is a source in no zone. */
export const pairKey = (src: string, dst: string) => `${src.toLowerCase()}\u0000${dst.toLowerCase()}`

/** The hits of the window summed per zone pair, every verdict and bucket together. */
export function hitsByPair(traffic: Pick<MicrosegTraffic, 'buckets'>): Map<string, number> {
  const pairs = new Map<string, number>()
  for (const b of traffic.buckets) {
    const key = pairKey(b.src_zone, b.zone)
    pairs.set(key, (pairs.get(key) ?? 0) + b.hits)
  }
  return pairs
}

/**
 * The hits of the last 24 hours per zone pair, from the persisted history (the engine's database, no Proxmox call):
 * ONE read for the whole tab, refreshed every 5 minutes while the page is visible. A failure (an older orchestrator,
 * a follower) is not retried: the table shows no hits.
 */
export function useFlowHits(connId: string | null): { pairs: Map<string, number> | null; failed: boolean } {
  const api = useMemo(() => (connId ? microsegApi(connId) : null), [connId])
  const key = connId ? [`${microsegBaseUrl(connId)}/traffic`, 'flow-hits-24h'] : null
  const { data, error } = useSWR<MicrosegTraffic, MicrosegApiError>(
    key,
    () => {
      const { from, to } = hitsWindow(Date.now())
      return api!.getMicrosegTraffic({ from: new Date(from).toISOString(), to: new Date(to).toISOString(), step: HOUR_MS / 1000 })
    },
    { refreshInterval: FLOW_HITS_REFRESH_MS, refreshWhenHidden: false, revalidateOnFocus: false, shouldRetryOnError: false },
  )
  const pairs = useMemo(() => (data ? hitsByPair(data) : null), [data])
  return { pairs, failed: !!error && !data }
}
