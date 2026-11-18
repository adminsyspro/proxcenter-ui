// src/lib/microseg/useMicrosegStatus.ts

import { useMemo } from 'react'
import useSWR from 'swr'

import { MicrosegApiError, microsegApi, microsegBaseUrl } from './api'
import { FATAL_CODES } from './useMicroseg'
import type { MicrosegStatus } from './types'

/** The engine state is read from the orchestrator's memory, so a slow refresh is cheap. */
export const STATUS_REFRESH_MS = 15_000

/**
 * GET /status of a connection: engine state, coverage, zones by state, emergency stop. `refreshMs` reads it faster for
 * a while (a manual check waiting in the queue).
 */
export function useMicrosegStatus(connId: string | null | undefined, refreshMs = STATUS_REFRESH_MS) {
  const api = useMemo(() => (connId ? microsegApi(connId) : null), [connId])
  const key = connId ? `${microsegBaseUrl(connId)}/status` : null
  const { data, error, isLoading, mutate } = useSWR<MicrosegStatus, MicrosegApiError>(
    key,
    () => api!.getStatus(),
    {
      refreshInterval: refreshMs,
      shouldRetryOnError: (e: MicrosegApiError) => !FATAL_CODES.has(e?.code),
    },
  )
  return { data, loading: isLoading, error, reload: () => mutate() }
}

/** No read of its own: no request on mount, on focus, on reconnect nor on a timer. */
const CACHE_ONLY = { revalidateOnMount: false, revalidateIfStale: false, revalidateOnFocus: false, revalidateOnReconnect: false, refreshInterval: 0 } as const

/**
 * The GET /status of a connection as another screen last read it (the banner reads every visible cluster of the tab),
 * from the SWR cache of the same key: this hook never sends a request, it only follows the answers of that read.
 */
export function useCachedMicrosegStatus(connId: string | null | undefined) {
  const api = useMemo(() => (connId ? microsegApi(connId) : null), [connId])
  const key = connId ? `${microsegBaseUrl(connId)}/status` : null
  const { data, error } = useSWR<MicrosegStatus, MicrosegApiError>(key, () => api!.getStatus(), CACHE_ONLY)
  return { data, error, loading: false }
}
