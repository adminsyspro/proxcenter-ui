// src/lib/microseg/useMicrosegLists.ts

import { useMemo } from 'react'
import useSWR from 'swr'

import { MicrosegApiError, microsegApi, microsegBaseUrl, type ListSuggestionsParams } from './api'
import { FATAL_CODES } from './useMicroseg'
import type { MicrosegDrift, MicrosegSuggestion } from './types'

/** The drifts are the engine's own memory of its last full run, which is rarely more often than every few minutes. */
export const DRIFTS_REFRESH_MS = 60_000

const shouldRetry = (e: MicrosegApiError) => !FATAL_CODES.has(e?.code)

/** GET /drifts: what differs between the policy and Proxmox, as the last full run found it. */
export function useMicrosegDrifts(connId: string | null | undefined) {
  const api = useMemo(() => (connId ? microsegApi(connId) : null), [connId])
  const key = connId ? `${microsegBaseUrl(connId)}/drifts` : null
  const { data, error, isLoading, mutate } = useSWR<MicrosegDrift[], MicrosegApiError>(key, () => api!.getDrifts(), {
    refreshInterval: DRIFTS_REFRESH_MS,
    shouldRetryOnError: shouldRetry,
  })
  return { data, loading: isLoading, error, reload: () => mutate() }
}

/**
 * GET /suggestions for one page. The previous page stays on screen while the
 * next one loads (a filter or a page change must not blank the list).
 */
export function useMicrosegSuggestions(connId: string | null | undefined, params: ListSuggestionsParams) {
  const api = useMemo(() => (connId ? microsegApi(connId) : null), [connId])
  const key = connId ? [`${microsegBaseUrl(connId)}/suggestions`, params.kind, params.status, params.zone, params.limit, params.offset] : null
  const { data, error, isLoading, isValidating, mutate } = useSWR<MicrosegSuggestion[], MicrosegApiError>(
    key,
    async () => (await api!.listSuggestions(params)).suggestions,
    { keepPreviousData: true, shouldRetryOnError: shouldRetry },
  )
  return { data, loading: isLoading, validating: isValidating, error, reload: () => mutate() }
}
