import { useMemo } from 'react'
import useSWR, { unstable_serialize, useSWRConfig } from 'swr'

import { MicrosegApiError, microsegApi, microsegBaseUrl } from '@/lib/microseg/api'
import type { MicrosegTraffic } from '@/lib/microseg/types'
import { useMergedClusters, type ClusterRead } from '@/lib/microseg/useMerged'

const HOUR_MS = 3_600_000

/**
 * The Policy sub-tab reads the last 24 hours, again every minute: the pace at which the engine reads the log and adds
 * to the history (orchestrator database, no Proxmox call), so the figures of a zone just put in observation show up.
 */
export const UNCOVERED_REFRESH_MS = 60_000

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
    // An outbound bucket is logged by the emitting zone: it is no traffic into it.
    if (b.direction === 'out') continue
    const key = b.zone.toLowerCase()
    zones.set(key, (zones.get(key) ?? 0) + b.hits)
  }
  return zones
}

/** The hourly hits of each zone over the window, oldest first, plus where the window starts and its step. */
export type UncoveredSeries = {
  from: number
  stepMs: number
  size: number
  /** Inbound: the hits of the traffic into each zone. */
  byZone: Map<string, number[]>
  /** Outbound: the hits of the traffic each zone emitted (its outbound buckets). */
  outByZone: Map<string, number[]>
}

/**
 * The hits of each zone per bucket of the answer (24 hourly buckets for the Policy window), by name whatever
 * the case, every source and verdict together: a bucket with no row is 0. A bucket outside the window is dropped.
 */
export function uncoveredSeriesByZone(traffic: Pick<MicrosegTraffic, 'buckets' | 'from' | 'to' | 'step'>): UncoveredSeries {
  const from = Date.parse(traffic.from)
  const stepMs = Math.max(1, traffic.step) * 1000
  const size = Math.max(0, Math.round((Date.parse(traffic.to) - from) / stepMs))
  const byZone = new Map<string, number[]>()
  const outByZone = new Map<string, number[]>()
  for (const b of traffic.buckets) {
    const i = Math.floor((Date.parse(b.at) - from) / stepMs)
    if (!(i >= 0 && i < size)) continue
    const key = b.zone.toLowerCase()
    const rows = b.direction === 'out' ? outByZone : byZone
    let row = rows.get(key)
    if (!row) rows.set(key, (row = new Array<number>(size).fill(0)))
    row[i] += b.hits
  }
  return { from, stepMs, size, byZone, outByZone }
}

/** The hourly series of a zone, with the name it had in the applied revision when the draft renamed it (as uncoveredOf). */
export function uncoveredSeriesOf(series: UncoveredSeries, name: string, previousName?: string, direction: 'in' | 'out' = 'in'): number[] {
  const rowsOf = direction === 'out' ? series.outByZone : series.byZone
  const pick = (n: string) => rowsOf.get(n.toLowerCase())
  const rows = [pick(name), previousName && previousName.toLowerCase() !== name.toLowerCase() ? pick(previousName) : undefined]
  return Array.from({ length: series.size }, (_, i) => rows.reduce((sum, row) => sum + (row?.[i] ?? 0), 0))
}

/** The 24-hour history of one cluster, refreshed every minute while the page is visible (one SWR read per cluster). */
function useClusterTraffic(connId: string | null, refreshMs = UNCOVERED_REFRESH_MS): ClusterRead<MicrosegTraffic> {
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
    { refreshInterval: refreshMs, refreshWhenHidden: false, revalidateOnFocus: false, revalidateOnMount: !held, shouldRetryOnError: false },
  )
  return { data, error, loading: !!key && data === undefined && error === undefined }
}

/**
 * The histories of the clusters of a shared policy as one: every bucket in the window of the latest answer (each read
 * takes the window of its own time, an hour apart at most), the zones by name. Null without any answer.
 */
export function mergeTraffic(answers: readonly MicrosegTraffic[]): MicrosegTraffic | null {
  if (answers.length === 0) return null
  if (answers.length === 1) return answers[0]
  const latest = answers.reduce((a, b) => (Date.parse(b.to) > Date.parse(a.to) ? b : a), answers[0])
  const from = Date.parse(latest.from)
  const to = Date.parse(latest.to)
  // A window that cannot be read cuts nothing.
  const inWindow = (at: number) => !Number.isFinite(from) || !Number.isFinite(to) || (at >= from && at < to)
  const buckets = answers.flatMap(a => a.buckets.filter(b => inWindow(Date.parse(b.at))))
  return { ...latest, buckets }
}

/**
 * The uncovered traffic of the last 24 hours per destination zone, from the persisted history (the engine's database,
 * no Proxmox call). On a policy shared by several clusters, each cluster logs the traffic of its own guests: the
 * history of every cluster of the group (`clusterIds`, the connection alone without it) is read, one read per cluster,
 * and summed by zone name. Every screen reads the same keys (the Policy table, the Observation zone banner, the
 * observed flow dialog). A cluster whose read fails is left out; the table shows no count only when every read fails.
 */
export function useZoneUncovered(connId: string | null, clusterIds?: readonly string[]): { byZone: Map<string, number> | null; series: UncoveredSeries | null; traffic: MicrosegTraffic | null; failed: boolean } {
  const ids = useMemo(() => {
    if (clusterIds?.length) return [...clusterIds]
    return connId ? [connId] : []
  }, [clusterIds, connId])
  const { byCluster, errors } = useMergedClusters(ids, useClusterTraffic, UNCOVERED_REFRESH_MS)
  const data = useMemo(
    () => mergeTraffic(ids.flatMap(id => { const answer = byCluster[id]; return answer ? [answer] : [] })),
    [ids, byCluster],
  )
  const byZone = useMemo(() => (data ? uncoveredByZone(data) : null), [data])
  const series = useMemo(() => (data ? uncoveredSeriesByZone(data) : null), [data])
  const failed = !data && ids.length > 0 && ids.every(id => id in errors)
  return { byZone, series, traffic: data, failed }
}

/**
 * The uncovered hits of a zone: those logged under its name, plus those logged under the name it had in the applied
 * revision when the draft renamed it (the history keeps the name of the time).
 */
export function uncoveredOf(byZone: ReadonlyMap<string, number>, name: string, previousName?: string): number {
  const now = byZone.get(name.toLowerCase()) ?? 0
  return previousName && previousName.toLowerCase() !== name.toLowerCase() ? now + (byZone.get(previousName.toLowerCase()) ?? 0) : now
}
