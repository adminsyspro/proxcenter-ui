'use client'

import { useMemo } from 'react'

import { useSWRFetch } from '@/hooks/useSWRFetch'
import { DEFAULT_BASEMAP_SETTINGS, normalizeBasemapSettings, type BasemapSettings } from '@/lib/map/basemap'

interface BasemapPayload {
  data?: unknown
  canEdit?: boolean
}

/**
 * The instance basemap configuration, shared by every map on the page.
 *
 * SWR dedupes the call, so two maps mounted at once hit the route once. The
 * object is memoised on the raw payload (which useSWRFetch keeps referentially
 * stable through its dequal compare) because a fresh object on every render
 * would retrigger any effect that depends on it.
 */
export function useBasemapSettings() {
  const { data, error, isLoading, mutate } = useSWRFetch<BasemapPayload>('/api/v1/settings/map', {
    revalidateOnFocus: false,
    dedupingInterval: 60_000,
  })

  const settings: BasemapSettings = useMemo(
    () => (data ? normalizeBasemapSettings(data.data) : { ...DEFAULT_BASEMAP_SETTINGS }),
    [data],
  )

  return { settings, canEdit: data?.canEdit === true, isLoading, error, mutate }
}
