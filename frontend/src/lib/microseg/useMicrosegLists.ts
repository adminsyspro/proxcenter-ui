// src/lib/microseg/useMicrosegLists.ts

import { useMemo } from 'react'
import useSWR from 'swr'

import { MicrosegApiError, microsegApi, microsegBaseUrl, type ListRunsParams, type ListSuggestionsParams } from './api'
import { FATAL_CODES } from './useMicroseg'
import type { MicrosegDrift, MicrosegRevision, MicrosegRun, MicrosegSuggestion } from './types'

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

/** The revisions endpoint takes a limit and no offset (max 100): the History sub-tab pages what it got. */
export const REVISIONS_LIMIT = 100

/** A run lasts seconds to minutes and the engine adds one every few minutes: the list follows at a calm pace. */
export const RUNS_REFRESH_MS = 15_000

/** GET /revisions: the latest revisions with their snapshots, newest first. */
export function useMicrosegRevisions(connId: string | null | undefined, limit = REVISIONS_LIMIT) {
  const api = useMemo(() => (connId ? microsegApi(connId) : null), [connId])
  const key = connId ? `${microsegBaseUrl(connId)}/revisions?limit=${limit}` : null
  const { data, error, isLoading, mutate } = useSWR<MicrosegRevision[], MicrosegApiError>(key, () => api!.listRevisions(limit), {
    shouldRetryOnError: shouldRetry,
  })
  return { data, loading: isLoading, error, reload: () => mutate() }
}

/** GET /runs for one page (the list omits the result of each run). The previous page stays while the next loads. */
export function useMicrosegRuns(connId: string | null | undefined, params: ListRunsParams) {
  const api = useMemo(() => (connId ? microsegApi(connId) : null), [connId])
  const key = connId ? [`${microsegBaseUrl(connId)}/runs`, params.limit, params.offset] : null
  const { data, error, isLoading, mutate } = useSWR<MicrosegRun[], MicrosegApiError>(
    key,
    async () => (await api!.listRuns(params)).runs,
    { keepPreviousData: true, refreshInterval: RUNS_REFRESH_MS, shouldRetryOnError: shouldRetry },
  )
  return { data, loading: isLoading, error, reload: () => mutate() }
}

/** GET /runs/{id} with its result, read once a row is opened. */
export function useMicrosegRunResult(connId: string | null | undefined, runId: string | null) {
  const api = useMemo(() => (connId ? microsegApi(connId) : null), [connId])
  const key = connId && runId ? `${microsegBaseUrl(connId)}/runs/${encodeURIComponent(runId)}` : null
  const { data, error, isLoading, mutate } = useSWR<MicrosegRun, MicrosegApiError>(key, () => api!.getRun(runId!), {
    revalidateOnFocus: false,
    shouldRetryOnError: shouldRetry,
  })
  return { data, loading: isLoading, error, reload: () => mutate() }
}
