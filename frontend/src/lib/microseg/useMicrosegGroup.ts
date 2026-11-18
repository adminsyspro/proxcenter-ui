// src/lib/microseg/useMicrosegGroup.ts

import { useMemo } from 'react'
import useSWR, { type SWRConfiguration } from 'swr'
import { dequal } from 'dequal'

import { microsegApi, microsegBaseUrl, type MicrosegApiError, type MicrosegClusterList } from './api'
import { FATAL_CODES } from './useMicroseg'
import type { MicrosegCluster } from './types'

/** The most clusters a policy takes (the backend's `max`, TOO_MANY_CLUSTERS past it): per-cluster reads use as many slots. */
export const MAX_POLICY_CONNECTIONS = 8

/** "/api/v1/firewall/microseg/": the relay base without a connection (ends with the slash). */
const MICROSEG_BASE = microsegBaseUrl('')

/** The SWR key of a connection's clusters read. */
export function clustersKey(connId: string): string {
  return `${microsegBaseUrl(connId)}/clusters`
}

/** True for the clusters key of any connection (to revalidate every group after an association or a dissociation). */
export function isClustersKey(key: unknown): key is string {
  return typeof key === 'string' && key.startsWith(MICROSEG_BASE) && key.endsWith('/clusters')
}

/** What a caller may tune of the read (the page's selector does not revalidate it on its own). */
export type GroupReadOptions = Pick<SWRConfiguration, 'revalidateIfStale' | 'revalidateOnReconnect'>

/**
 * The clusters that share the policy of a connection. `anchor` is the smallest connection ID of the group, so every
 * screen of the group builds the same SWR keys whichever cluster it was opened from. Before the first answer, and
 * when the read fails, the group is the connection alone.
 *
 * The read is cached under the passed connection's key because the anchor is unknown until it answers: consumers
 * must wait for `loading === false` before building keys from `anchor`. The smallest ID is a plain string sort, a
 * UI-only convention. Membership changes only through `reload()`, so focus does not revalidate it.
 */
export function useMicrosegGroup(connId: string, options?: GroupReadOptions) {
  const { data, error, isLoading, mutate } = useSWR<MicrosegClusterList, MicrosegApiError>(
    // No connection (the page has none selected yet): nothing is read.
    connId ? clustersKey(connId) : null,
    () => microsegApi(connId).listClusters(),
    { compare: dequal, revalidateOnFocus: false, shouldRetryOnError: (e: MicrosegApiError) => !FATAL_CODES.has(e?.code), ...options },
  )
  const clusters = data?.clusters
  const max = data?.max
  return useMemo(() => {
    const list: MicrosegCluster[] = clusters && clusters.length > 0 ? clusters : []
    const ids = list.length > 0 ? list.map(c => c.connection_id).sort() : [connId]
    const activeIds = list.length > 0 ? ids.filter(id => list.find(c => c.connection_id === id)?.active) : [connId]
    return {
      anchor: ids[0],
      clusters: list,
      ids,
      activeIds,
      shared: ids.length > 1,
      /** The most clusters a policy takes, as the backend says; undefined until it answers. */
      max,
      loading: isLoading,
      error: error as unknown,
      reload: () => { void mutate() },
    }
  }, [clusters, max, connId, isLoading, error, mutate])
}
