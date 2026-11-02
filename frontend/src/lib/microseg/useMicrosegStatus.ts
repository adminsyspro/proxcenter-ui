// src/lib/microseg/useMicrosegStatus.ts

import { useMemo } from 'react'
import useSWR from 'swr'

import { MicrosegApiError, microsegApi, microsegBaseUrl } from './api'
import { FATAL_CODES } from './useMicroseg'
import type { MicrosegStatus } from './types'

/** The engine state is read from the orchestrator's memory, so a slow refresh is cheap. */
export const STATUS_REFRESH_MS = 15_000

/** GET /status of a connection: engine state, coverage, zones by state, emergency stop. */
export function useMicrosegStatus(connId: string | null | undefined) {
  const api = useMemo(() => (connId ? microsegApi(connId) : null), [connId])
  const key = connId ? `${microsegBaseUrl(connId)}/status` : null
  const { data, error, isLoading, mutate } = useSWR<MicrosegStatus, MicrosegApiError>(
    key,
    () => api!.getStatus(),
    {
      refreshInterval: STATUS_REFRESH_MS,
      shouldRetryOnError: (e: MicrosegApiError) => !FATAL_CODES.has(e?.code),
    },
  )
  return { data, loading: isLoading, error, reload: () => mutate() }
}
