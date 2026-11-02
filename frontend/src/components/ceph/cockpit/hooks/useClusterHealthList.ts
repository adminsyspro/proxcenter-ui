'use client'

import { useCallback } from 'react'
import useSWR, { useSWRConfig } from 'swr'

import { isCephLive } from '@/lib/ceph/shape'

import { fetchCockpitShaped, isNotFound } from './cockpitFetch'

const KEY_PREFIX = 'ceph-cluster-health:'

export type ClusterHealthEntry = { status: string | null; error: boolean; absent: boolean }

async function loadAll(ids: string[]): Promise<Record<string, ClusterHealthEntry>> {
  const entries = await Promise.all(ids.map(async (id): Promise<[string, ClusterHealthEntry]> => {
    try {
      const live = await fetchCockpitShaped(`/api/v1/connections/${encodeURIComponent(id)}/ceph/live`, isCephLive)

      return [id, { status: live.health.status, error: false, absent: false }]
    } catch (e) {
      // 404 = ce cluster n'a pas de Ceph (hasCeph:false), pas une panne.
      return [id, isNotFound(e) ? { status: null, error: false, absent: true } : { status: null, error: true, absent: false }]
    }
  }))

  return Object.fromEntries(entries)
}

/** Une lecture `/ceph/live` par connexion a l'ouverture (pastilles du selecteur), sans polling. */
export function useClusterHealthList(connIds: string[]): Record<string, ClusterHealthEntry> {
  const ids = [...new Set(connIds)].sort((a, b) => a.localeCompare(b))
  const key = ids.length ? `${KEY_PREFIX}${ids.join(',')}` : null

  const { data } = useSWR<Record<string, ClusterHealthEntry>>(key, () => loadAll(ids), {
    revalidateOnFocus: false,
    revalidateOnReconnect: false,
    revalidateIfStale: false,
    refreshInterval: 0,
  })

  return data ?? {}
}

/** Relit les pastilles de toutes les listes ouvertes (bouton rafraichir du cockpit). */
export function useRefreshClusterHealthList(): () => void {
  const { mutate } = useSWRConfig()

  return useCallback(() => {
    void mutate((key: unknown) => typeof key === 'string' && key.startsWith(KEY_PREFIX))
  }, [mutate])
}
