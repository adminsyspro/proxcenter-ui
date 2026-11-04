import { useMemo } from 'react'
import useSWR, { unstable_serialize, useSWRConfig } from 'swr'

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
 * no Proxmox call): ONE read for the whole tab (the Observation zone banner reuses it), refreshed every 5 minutes while
 * the page is visible. A failure (an
 * older orchestrator, a follower) is not retried: the table shows no count.
 */
/** The hourly hits of each zone over the window, oldest first, plus where the window starts and its step. */
export type UncoveredSeries = { from: number; stepMs: number; size: number; byZone: Map<string, number[]> }

/**
 * The hits of each destination zone per bucket of the answer (24 hourly buckets for the Policy window), by name whatever
 * the case, every source and verdict together: a bucket with no row is 0. A bucket outside the window is dropped.
 */
export function uncoveredSeriesByZone(traffic: Pick<MicrosegTraffic, 'buckets' | 'from' | 'to' | 'step'>): UncoveredSeries {
  const from = Date.parse(traffic.from)
  const stepMs = Math.max(1, traffic.step) * 1000
  const size = Math.max(0, Math.round((Date.parse(traffic.to) - from) / stepMs))
  const byZone = new Map<string, number[]>()
  for (const b of traffic.buckets) {
    const i = Math.floor((Date.parse(b.at) - from) / stepMs)
    if (!(i >= 0 && i < size)) continue
    const key = b.zone.toLowerCase()
    let row = byZone.get(key)
    if (!row) byZone.set(key, (row = new Array<number>(size).fill(0)))
    row[i] += b.hits
  }
  return { from, stepMs, size, byZone }
}

/** The hourly series of a zone, with the name it had in the applied revision when the draft renamed it (as uncoveredOf). */
export function uncoveredSeriesOf(series: UncoveredSeries, name: string, previousName?: string): number[] {
  const pick = (n: string) => series.byZone.get(n.toLowerCase())
  const rows = [pick(name), previousName && previousName.toLowerCase() !== name.toLowerCase() ? pick(previousName) : undefined]
  return Array.from({ length: series.size }, (_, i) => rows.reduce((sum, row) => sum + (row?.[i] ?? 0), 0))
}

export function useZoneUncovered(connId: string | null): { byZone: Map<string, number> | null; series: UncoveredSeries | null; failed: boolean } {
  const api = useMemo(() => (connId ? microsegApi(connId) : null), [connId])
  const key = connId ? [`${microsegBaseUrl(connId)}/traffic`, 'zone-uncovered-24h'] : null
  // A held answer serves a new reader (the Observation banner after the Policy table) until the next refresh.
  const { cache } = useSWRConfig()
  const held = !!key && cache.get(unstable_serialize(key))?.data !== undefined
  const { data, error } = useSWR<MicrosegTraffic, MicrosegApiError>(
    key,
    () => {
      const { from, to } = hitsWindow(Date.now())
      return api!.getMicrosegTraffic({ from: new Date(from).toISOString(), to: new Date(to).toISOString(), step: HOUR_MS / 1000 })
    },
    { refreshInterval: UNCOVERED_REFRESH_MS, refreshWhenHidden: false, revalidateOnFocus: false, revalidateOnMount: !held, shouldRetryOnError: false },
  )
  const byZone = useMemo(() => (data ? uncoveredByZone(data) : null), [data])
  const series = useMemo(() => (data ? uncoveredSeriesByZone(data) : null), [data])
  return { byZone, series, failed: !!error && !data }
}

/**
 * The uncovered hits of a zone: those logged under its name, plus those logged under the name it had in the applied
 * revision when the draft renamed it (the history keeps the name of the time).
 */
export function uncoveredOf(byZone: ReadonlyMap<string, number>, name: string, previousName?: string): number {
  const now = byZone.get(name.toLowerCase()) ?? 0
  return previousName && previousName.toLowerCase() !== name.toLowerCase() ? now + (byZone.get(previousName.toLowerCase()) ?? 0) : now
}
