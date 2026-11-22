import { useMemo } from 'react'
import useSWR from 'swr'

import { MicrosegApiError, microsegApi, microsegBaseUrl } from '@/lib/microseg/api'
import type { MicrosegVolume } from '@/lib/microseg/types'
import { useMergedClusters, type ClusterRead } from '@/lib/microseg/useMerged'
import { sharedEnd, volumePeriodOf, volumeSeries, type VolumePeriod, type VolumeRule } from '@/lib/microseg/volume'

import { HISTORY_REFRESH_MS } from '../usePostureHistory'
import { historyWindow, stepMsOf, type TimelineRange } from '../postureTimeline'
import { useNow } from './useNow'

/** The range of the history a period of the map reads: "whenever" reads the last 24 hours, as the totals do. */
export const rangeOfPeriod = (period: VolumePeriod | 'all'): TimelineRange => volumePeriodOf(period)

/** The guests an edge is drawn from or to: its cluster, and the VMIDs of its ends that are guests. */
export type EdgeGuests = { conn: string; src?: number; dst?: number }

const NO_CLUSTER: string[] = []

/**
 * The sFlow volume of one edge over the period of the map, in the steps of the history (the orchestrator's database,
 * no Proxmox call), summed over the clusters of the policy: read when its tooltip opens only, narrowed to its pair of
 * zones, every service apart so that the flows of the edge pick theirs. An edge drawn from or to a guest (`guests`)
 * reads the volume by pair of guests of its cluster instead, narrowed to its guests. `series` holds the bytes of each
 * step.
 */
export function useEdgeVolumeHistory(clusterIds: readonly string[], period: VolumePeriod | 'all', rules: readonly VolumeRule[], guests?: EdgeGuests | null) {
  const range = rangeOfPeriod(period)
  const now = useNow(HISTORY_REFRESH_MS)
  const span = useMemo(() => historyWindow(now, range), [now, range])
  const stepMs = stepMsOf(range)
  const src = sharedEnd(rules, 'src')
  const dst = sharedEnd(rules, 'dst')
  const guestConn = guests?.conn ?? null
  const srcVmid = guests?.src
  const dstVmid = guests?.dst
  const useOne = useMemo(() => function useEdgeVolume(connId: string | null): ClusterRead<MicrosegVolume> {
    const window = { from: new Date(span.from).toISOString(), to: new Date(span.to).toISOString(), step: stepMs / 1000 }
    const key = connId ? [`${microsegBaseUrl(connId)}/volume`, 'edge', guestConn ? `guest:${srcVmid ?? '*'}>${dstVmid ?? '*'}` : `${src ?? '*'}>${dst ?? '*'}`, span.from, span.to, stepMs] : null
    const { data, error } = useSWR<MicrosegVolume, MicrosegApiError>(
      key,
      () => (guestConn
        ? microsegApi(connId!).getMicrosegVolumeGuests({ ...window, src_vmid: srcVmid, dst_vmid: dstVmid })
        : microsegApi(connId!).getMicrosegVolume({ ...window, src_zone: src, dst_zone: dst })),
      { refreshWhenHidden: false, revalidateOnFocus: false, shouldRetryOnError: false, keepPreviousData: true },
    )
    return { data, error, loading: !!key && data === undefined && error === undefined }
  }, [src, dst, guestConn, srcVmid, dstVmid, span.from, span.to, stepMs])
  const ids = useMemo(() => (guestConn ? [guestConn] : clusterIds), [guestConn, clusterIds])
  const { byCluster, loading } = useMergedClusters(ids.length ? ids : NO_CLUSTER, useOne)
  const series = useMemo(() => {
    // Every step the window touches: the last one is partial (the window ends on the next 5 minutes), never dropped.
    const count = Math.ceil((span.to - span.from) / stepMs)
    const rows = Object.values(byCluster).flatMap(answer => (answer?.covered ? answer.buckets : []))
    return volumeSeries(rows, rules, span.from, stepMs, count)
  }, [byCluster, rules, span.from, span.to, stepMs])
  return { series, range, loading }
}
