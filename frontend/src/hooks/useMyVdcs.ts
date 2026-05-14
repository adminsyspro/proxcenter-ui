'use client'

import useSWR from 'swr'

import type { VdcWithDetails } from '@/lib/vdc/types'

/** A tenant-owned vDC as returned by GET /api/v1/vdcs (full details). */
export type MyVdc = VdcWithDetails

const fetcher = async (url: string): Promise<MyVdc[]> => {
  const res = await fetch(url)

  if (!res.ok) throw new Error(`Failed to fetch vDCs (${res.status})`)
  const json = await res.json()


return Array.isArray(json?.data) ? json.data : []
}

/**
 * Fetches the current tenant's vDCs. Drives the "vDC mode" flag used by the
 * menu and by the /home redirect, plus feeds the /my-vdc cockpit.
 *
 * SWR caches for 30 s and revalidates on focus so a freshly-allocated vDC
 * surfaces within seconds without manual refresh. During an error, `vdcs`
 * degrades to `[]` and `hasVdc` therefore reads `false` — consumers that
 * must distinguish "no vDC" from "unavailable" should also check `error`.
 */
export function useMyVdcs() {
  const { data, error, isLoading, mutate } = useSWR<MyVdc[]>(
    '/api/v1/vdcs',
    fetcher,
    {
      refreshInterval: 30_000,
      revalidateOnFocus: true,
      dedupingInterval: 5_000,
    }
  )

  const vdcs = data ?? []


return {
    vdcs,
    hasVdc: vdcs.length > 0,
    loading: isLoading,
    error,
    mutate,
  }
}
