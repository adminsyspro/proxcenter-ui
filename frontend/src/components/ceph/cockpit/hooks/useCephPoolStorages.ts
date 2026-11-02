'use client'

import useSWR from 'swr'

import { COCKPIT_SWR_RETRY, fetchCockpitData } from './cockpitFetch'

interface StorageEntry {
  storage?: unknown
  type?: unknown
  pool?: unknown
}

/**
 * PVE storages that sit on a Ceph pool, by pool name. One read when the Pools tab
 * opens (the connection's storage list: /cluster/resources + /storage, 2 PVE calls),
 * then the SWR cache, with no polling and no revalidation on focus. A pool is matched
 * on the `pool` field of the `rbd` and `cephfs` storages.
 */
export function useCephPoolStorages(conn: string | null) {
  const key = conn ? (['ceph-cockpit', 'pool-storages', conn] as const) : null

  const { data, error, isLoading } = useSWR<Record<string, string[]>, Error, typeof key>(
    key,
    async ([, , id]: readonly [string, string, string]) => {
      const list = await fetchCockpitData<unknown>(`/api/v1/connections/${encodeURIComponent(id)}/storage`)
      const byPool: Record<string, string[]> = {}

      for (const entry of Array.isArray(list) ? (list as StorageEntry[]) : []) {
        if (!entry || (entry.type !== 'rbd' && entry.type !== 'cephfs')) continue
        if (typeof entry.pool !== 'string' || typeof entry.storage !== 'string' || !entry.pool) continue

        const names = (byPool[entry.pool] ??= [])

        if (!names.includes(entry.storage)) names.push(entry.storage)
      }

      return byPool
    },
    { revalidateOnFocus: false, revalidateIfStale: false, revalidateOnReconnect: false, ...COCKPIT_SWR_RETRY },
  )

  return { storages: data ?? null, loading: isLoading, error: (error as Error | undefined) ?? null }
}
