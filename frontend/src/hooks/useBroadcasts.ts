'use client'

import { useSWRFetch } from '@/hooks/useSWRFetch'
import type { PublicBroadcast } from '@/lib/broadcast/types'

/**
 * SWR cache key of the active-banners endpoint. Exported so the
 * administration tab can invalidate it the moment it writes, instead of
 * repeating the path and letting the two drift apart.
 */
export const ACTIVE_BROADCASTS_KEY = '/api/v1/broadcasts/active'

/**
 * Active banners for the current session. Polled so a maintenance notice
 * appears within a minute without a reload, and disappears on its own when
 * the window closes. The window is evaluated with the server clock.
 */
export function useBroadcasts(): { banners: PublicBroadcast[]; isLoading: boolean } {
  const { data, isLoading } = useSWRFetch<{ data: PublicBroadcast[] }>(ACTIVE_BROADCASTS_KEY, {
    refreshInterval: 60000,
    revalidateOnFocus: true,
  })

  return {
    banners: Array.isArray(data?.data) ? data!.data : [],
    isLoading: !!isLoading,
  }
}
