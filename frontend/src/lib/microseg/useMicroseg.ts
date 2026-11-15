// src/lib/microseg/useMicroseg.ts

import { useEffect, useMemo, useState } from 'react'
import useSWR from 'swr'
import { dequal } from 'dequal'

import { MicrosegApiError, microsegApi, microsegBaseUrl } from './api'
import type { MicrosegPolicy, MicrosegRun } from './types'

export const RUN_POLL_MS = 2000
/** The longest wait between two reads of a run that keeps failing. */
export const RUN_POLL_MAX_MS = 30_000

/** The wait after the n-th failure in a row (n >= 1): 2 s, 4 s, 8 s, 16 s, then 30 s. */
export function runRetryDelay(failures: number): number {
  return Math.min(RUN_POLL_MS * 2 ** Math.max(0, failures - 1), RUN_POLL_MAX_MS)
}

// An error that trying again cannot cure.
export const FATAL_CODES = new Set(['NOT_FOUND', 'UNAUTHORIZED', 'FORBIDDEN', 'FEATURE_REQUIRED'])

/** The draft of a connection: zones, flows, pending members, last revision. */
export function useMicrosegPolicy(connId: string | null | undefined) {
  const api = useMemo(() => (connId ? microsegApi(connId) : null), [connId])
  const key = connId ? `${microsegBaseUrl(connId)}/policy` : null
  const { data, error, isLoading, mutate } = useSWR<MicrosegPolicy, MicrosegApiError>(
    key,
    () => api!.getPolicy(),
    { compare: dequal, shouldRetryOnError: (e: MicrosegApiError) => !FATAL_CODES.has(e?.code) },
  )
  return {
    data,
    loading: isLoading,
    error,
    reload: () => mutate(),
    mutate,
  }
}

export function isRunFinished(run: Pick<MicrosegRun, 'status'> | null | undefined): boolean {
  return run?.status === 'done' || run?.status === 'failed'
}

/**
 * Follows a run: reads it at once, then every 2 s until it is `done` or
 * `failed`. A read that fails with a curable error is retried later and later
 * (runRetryDelay), back to every 2 s after the next success. Polling also
 * stops on unmount and when the connection or the run changes; an answer that
 * comes back after that is dropped.
 */
export function useMicrosegRun(connId: string | null | undefined, runId: string | null | undefined) {
  // The state is tagged with the run it belongs to, so a new connection or run
  // never shows the previous one's answer.
  const key = connId && runId ? `${connId}/${runId}` : null
  const [state, setState] = useState<{ key: string | null; run: MicrosegRun | null; error: Error | null }>({
    key: null, run: null, error: null,
  })

  useEffect(() => {
    if (!connId || !runId) return

    const stateKey = `${connId}/${runId}`
    let cancelled = false
    const api = microsegApi(connId)
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    let failures = 0

    const tick = async () => {
      let next: MicrosegRun
      try {
        next = await api.getRun(runId, controller.signal)
      } catch (e) {
        if (cancelled) return
        setState(prev => ({ key: stateKey, run: prev.key === stateKey ? prev.run : null, error: e as Error }))
        if (e instanceof MicrosegApiError && FATAL_CODES.has(e.code)) return
        failures += 1
        timer = setTimeout(tick, runRetryDelay(failures))
        return
      }
      if (cancelled) return
      failures = 0
      setState({ key: stateKey, run: next, error: null })
      if (!isRunFinished(next)) timer = setTimeout(tick, RUN_POLL_MS)
    }
    void tick()

    return () => {
      cancelled = true
      controller.abort()
      if (timer) clearTimeout(timer)
    }
  }, [connId, runId])

  const current = state.key === key
  const run = current ? state.run : null
  return { run, done: isRunFinished(run), error: current ? state.error : null }
}
