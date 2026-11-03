import { useMemo } from 'react'

import { useSWRFetch } from '@/hooks/useSWRFetch'
import type { LensPair } from '@/lib/microseg/trafficLens'

import type { PostureGuest } from './dashboardPosture'
import { connectionVmids, volumeWindow, type VmSeries } from './postureTimeline'

/** sFlow is read again at the pace of the events ring. */
export const VOLUME_REFRESH_MS = 60_000
/** The pairs the probe reads (the orchestrator's maximum). */
const PAIRS_LIMIT = 500

const READ_OPTIONS = { refreshInterval: VOLUME_REFRESH_MS, refreshWhenHidden: false, revalidateOnFocus: false }

export const sflowPairsUrl = () => `/api/v1/orchestrator/sflow?endpoint=ip-pairs&n=${PAIRS_LIMIT}`

export function sflowSeriesUrl(vmids: readonly number[], from: number, to: number): string {
  const q = new URLSearchParams({ endpoint: 'timeseries/all-vms', vmids: vmids.join(','), from: new Date(from).toISOString(), to: new Date(to).toISOString(), granularity: '5m' })
  return `/api/v1/orchestrator/sflow?${q}`
}

/**
 * The sFlow volume of the connection for the Posture time chart: the IP pairs of the collector (as the Network flows
 * lens reads them) tell whether it sees this connection's guests; only then their time series of the last 2 hours,
 * in 5-minute steps. Orchestrator memory and InfluxDB; the orchestrator names the VMs from a 30 s cache of each
 * connection's /cluster/resources, shared with the Network flows page. `available` is false when there is nothing to
 * draw (no sFlow, no pair of this connection, no time series store): the tab is not shown.
 */
export function usePostureVolume(connId: string | null, guests: readonly PostureGuest[], now: number) {
  const pairs = useSWRFetch<LensPair[]>(connId ? sflowPairsUrl() : null, READ_OPTIONS)
  const vmids = useMemo(() => connectionVmids(Array.isArray(pairs.data) ? pairs.data : [], guests), [pairs.data, guests])
  const { from, to } = volumeWindow(now)
  const series = useSWRFetch<VmSeries[]>(vmids.length ? sflowSeriesUrl(vmids, from, to) : null, READ_OPTIONS)
  const list = Array.isArray(series.data) ? series.data : []
  const available = vmids.length > 0 && list.some(vm => (vm.points ?? []).length > 0)
  return { available, series: list, from, to }
}
