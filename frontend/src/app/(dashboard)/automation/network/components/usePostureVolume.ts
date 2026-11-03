import { useState } from 'react'

import { useSWRFetch } from '@/hooks/useSWRFetch'
import type { LensPair } from '@/lib/microseg/trafficLens'

import type { PostureGuest } from './dashboardPosture'
import { accumulateVmids, busiestVmids, volumeWindow, type VmSeries, type VmidSeen } from './postureTimeline'

/** Whether sFlow sees the connection rarely changes: the pairs are probed every 5 minutes. */
export const PAIRS_REFRESH_MS = 300_000
/** The series follow the pace of the events ring. */
export const SERIES_REFRESH_MS = 60_000
/** The pairs the probe reads (the orchestrator's maximum). */
const PAIRS_LIMIT = 500

const COMMON = { refreshWhenHidden: false, revalidateOnFocus: false, shouldRetryOnError: false }
const PAIRS_OPTIONS = { ...COMMON, refreshInterval: PAIRS_REFRESH_MS }
// The key moves every 5 minutes (the window) and when a VMID joins the set: the chart stays on the previous figures meanwhile.
const SERIES_OPTIONS = { ...COMMON, refreshInterval: SERIES_REFRESH_MS, keepPreviousData: true }

export const sflowPairsUrl = () => `/api/v1/orchestrator/sflow?endpoint=ip-pairs&n=${PAIRS_LIMIT}`

export function sflowSeriesUrl(vmids: readonly number[], from: number, to: number): string {
  const q = new URLSearchParams({ endpoint: 'timeseries/all-vms', vmids: vmids.join(','), from: new Date(from).toISOString(), to: new Date(to).toISOString(), granularity: '5m' })
  return `/api/v1/orchestrator/sflow?${q}`
}

type Seen = { conn: string | null; source: unknown; guests: readonly PostureGuest[]; bytes: ReadonlyMap<number, VmidSeen> }

/**
 * The sFlow volume of the connection for the Posture time chart: the IP pairs of the collector (as the Network flows
 * lens reads them) tell whether it sees this connection's guests; only then their time series of the last 2 hours,
 * in 5-minute steps. The VMIDs asked are every guest of the connection the pairs named so far (the 100 busiest), so
 * the read does not change with each probe. Orchestrator memory and InfluxDB; the orchestrator names the VMs from a
 * 30 s cache of each connection's /cluster/resources, shared with the Network flows page. `available` is false when
 * there is nothing to draw (no sFlow, no pair of this connection, no time series store): the tab is not shown.
 *
 * Limit: sFlow keys its pairs and its series by VMID across the whole fleet. A pair is only taken for a guest when its
 * address is the guest's (once the guest addresses are read), but the series of a VMID that two connections share
 * cannot be split by connection: it holds the bytes of both.
 */
export function usePostureVolume(connId: string | null, guests: readonly PostureGuest[], now: number) {
  const pairs = useSWRFetch<LensPair[]>(connId ? sflowPairsUrl() : null, PAIRS_OPTIONS)
  const [seen, setSeen] = useState<Seen>({ conn: connId, source: undefined, guests: [], bytes: new Map() })
  // Derived during render from each new answer (or new guest list): the set only grows, and starts again on another connection.
  if (connId !== seen.conn || pairs.data !== seen.source || guests !== seen.guests) {
    const list = Array.isArray(pairs.data) ? pairs.data : []
    const base = connId === seen.conn ? seen.bytes : new Map<number, VmidSeen>()
    setSeen({ conn: connId, source: pairs.data, guests, bytes: accumulateVmids(base, list, guests) })
  }
  const vmids = busiestVmids(seen.bytes, guests)
  const { from, to } = volumeWindow(now)
  const series = useSWRFetch<VmSeries[]>(vmids.length ? sflowSeriesUrl(vmids, from, to) : null, SERIES_OPTIONS)
  // The previous key's figures are kept while the next read runs, never those of another connection.
  const list = connId === seen.conn && Array.isArray(series.data) ? series.data : []
  const available = vmids.length > 0 && list.some(vm => (vm.points ?? []).length > 0)
  return { available, series: list, from, to }
}
