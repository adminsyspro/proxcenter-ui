import { useMemo } from 'react'
import useSWR from 'swr'

import { MicrosegApiError, microsegApi, microsegBaseUrl } from '@/lib/microseg/api'
import type { MicrosegGuestVolume, MicrosegVolume, MicrosegVolumeGuestBucket } from '@/lib/microseg/types'
import { useMergedClusters, type ClusterRead } from '@/lib/microseg/useMerged'
import { mergeVolume, volumeWindow, type VolumePeriod } from '@/lib/microseg/volume'

/**
 * The volume totals are read again every minute: the pace at which the collectors write what they counted (the
 * orchestrator's database, no Proxmox call).
 */
export const VOLUME_REFRESH_MS = 60_000

type ClusterVolume = (connId: string | null, refreshMs?: number) => ClusterRead<MicrosegVolume>

/** The totals of one cluster over the window of a period, every pair and service apart (one SWR read per cluster and period). */
function clusterVolume(period: VolumePeriod | 'all'): ClusterVolume {
  return function useClusterVolume(connId, refreshMs = VOLUME_REFRESH_MS) {
    const api = useMemo(() => (connId ? microsegApi(connId) : null), [connId])
    const key = connId ? [`${microsegBaseUrl(connId)}/volume`, 'totals', period] : null
    const { data, error } = useSWR<MicrosegVolume, MicrosegApiError>(
      key,
      () => api!.getMicrosegVolume({ ...volumeWindow(Date.now(), period), totals: true }),
      { refreshInterval: refreshMs, refreshWhenHidden: false, revalidateOnFocus: false, shouldRetryOnError: false, keepPreviousData: true },
    )
    return { data, error, loading: !!key && data === undefined && error === undefined }
  }
}

// One reader per period, made once: the merged read calls the same hook from one render to the next.
const READERS = new Map<VolumePeriod | 'all', ClusterVolume>()
function readerOf(period: VolumePeriod | 'all'): ClusterVolume {
  let reader = READERS.get(period)
  if (!reader) READERS.set(period, (reader = clusterVolume(period)))
  return reader
}

/**
 * The sFlow volume totals of the period between the zones, summed over the clusters of a shared policy
 * (`clusterIds`, the connection alone without it), each cluster counting what its own guests send. Null while
 * nothing answered, or when every read failed; `covered` false when sFlow measures none of the clusters.
 */
export function useZoneVolume(
  connId: string | null, clusterIds: readonly string[] | undefined, period: VolumePeriod | 'all', shown?: readonly string[],
): MicrosegVolume | null {
  const ids = useMemo(() => {
    if (clusterIds?.length) return [...clusterIds]
    return connId ? [connId] : []
  }, [clusterIds, connId])
  const { byCluster } = useMergedClusters(ids, readerOf(period), VOLUME_REFRESH_MS)
  // `shown` sums some of the clusters read only (the Dashboard's filter), without another read.
  const shownKey = (shown ?? ids).join('|')
  return useMemo(() => mergeVolume(shownKey.split('|').flatMap(id => { const answer = byCluster[id]; return answer ? [answer] : [] })), [shownKey, byCluster])
}

/** A row of the volume by pair of guests with the cluster that counted it: a VMID names a guest in its cluster only. */
export type GuestVolumeRow = MicrosegVolumeGuestBucket & { conn: string }

type ClusterGuestVolume = (connId: string | null, refreshMs?: number) => ClusterRead<MicrosegGuestVolume>

/** The totals by pair of guests of one cluster over the window of a period (one SWR read per cluster and period). */
function clusterGuestVolume(period: VolumePeriod | 'all'): ClusterGuestVolume {
  return function useClusterGuestVolume(connId, refreshMs = VOLUME_REFRESH_MS) {
    const api = useMemo(() => (connId ? microsegApi(connId) : null), [connId])
    const key = connId ? [`${microsegBaseUrl(connId)}/volume`, 'guest-totals', period] : null
    const { data, error } = useSWR<MicrosegGuestVolume, MicrosegApiError>(
      key,
      () => api!.getMicrosegVolumeGuests({ ...volumeWindow(Date.now(), period), totals: true }),
      { refreshInterval: refreshMs, refreshWhenHidden: false, revalidateOnFocus: false, shouldRetryOnError: false, keepPreviousData: true },
    )
    return { data, error, loading: !!key && data === undefined && error === undefined }
  }
}

const GUEST_READERS = new Map<VolumePeriod | 'all', ClusterGuestVolume>()
function guestReaderOf(period: VolumePeriod | 'all'): ClusterGuestVolume {
  let reader = GUEST_READERS.get(period)
  if (!reader) GUEST_READERS.set(period, (reader = clusterGuestVolume(period)))
  return reader
}

const NO_IDS: string[] = []

/**
 * The sFlow volume totals of the period by pair of guests, of every cluster of the policy, each row with its cluster
 * (the orchestrator's database, no Proxmox call): what an edge drawn from a guest to a guest shows. `enabled` false
 * reads nothing (sFlow does not measure the map). A cluster whose read failed (too many pairs) has no row: its
 * traffic stays told between its zones.
 */
export function useGuestVolume(connId: string | null, clusterIds: readonly string[] | undefined, period: VolumePeriod | 'all', enabled: boolean): GuestVolumeRow[] {
  const ids = useMemo(() => {
    if (!enabled) return NO_IDS
    if (clusterIds?.length) return [...clusterIds]
    return connId ? [connId] : NO_IDS
  }, [enabled, clusterIds, connId])
  const { byCluster } = useMergedClusters(ids, guestReaderOf(period), VOLUME_REFRESH_MS)
  return useMemo(() => ids.flatMap(id => (byCluster[id]?.buckets ?? []).map(b => ({ ...b, conn: id }))), [ids, byCluster])
}
