'use client'

import { useState } from 'react'
import useSWR from 'swr'

import type { parseCrushMap } from '@/lib/ceph/crushRules'
import { isCrushMap } from '@/lib/ceph/shape'

import { useRevalidateErrorOnResume } from './useRevalidateErrorOnResume'
import { COCKPIT_SWR_RETRY, fetchCockpitShaped } from './cockpitFetch'

/** Charge a la premiere activation de l'onglet CRUSH, puis garde en cache SWR, sans rafraichissement automatique. */
export function useCephCrush(conn: string | null, active: boolean) {
  const [seen, setSeen] = useState<string | null>(null)

  // Etat derive pendant le rendu (et non dans un effet) : react.dev, "storing information from previous renders".
  if (active && conn && seen !== conn) setSeen(conn)

  const key = conn && (active || seen === conn) ? (['ceph-cockpit', 'crush', conn] as const) : null

  const { data, error, isLoading, mutate } = useSWR<ReturnType<typeof parseCrushMap>, Error, typeof key>(
    key,
    ([, , id]: readonly [string, string, string]) => fetchCockpitShaped(`/api/v1/connections/${encodeURIComponent(id)}/ceph/crush`, isCrushMap),
    { revalidateOnFocus: false, revalidateIfStale: false, revalidateOnReconnect: false, ...COCKPIT_SWR_RETRY }
  )

  useRevalidateErrorOnResume(error, mutate)

  return { crush: data ?? null, loading: isLoading, error: (error as Error | undefined) ?? null }
}
