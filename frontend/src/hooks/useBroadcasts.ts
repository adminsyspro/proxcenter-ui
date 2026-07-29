'use client'

import { useSWRFetch } from '@/hooks/useSWRFetch'
import type { PublicBroadcast } from '@/lib/broadcast/types'

/**
 * Active banners for the current session. Polled so a maintenance notice
 * appears within a minute without a reload, and disappears on its own when
 * the window closes. The window is evaluated with the server clock.
 */
export function useBroadcasts(): { banners: PublicBroadcast[]; isLoading: boolean } {
  const { data, isLoading } = useSWRFetch<{ data: PublicBroadcast[] }>('/api/v1/broadcasts/active', {
    refreshInterval: 60000,
    revalidateOnFocus: true,
  })

  return {
    banners: Array.isArray(data?.data) ? data!.data : [],
    isLoading: !!isLoading,
  }
}
