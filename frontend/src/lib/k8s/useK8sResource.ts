'use client'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ResourceListItem, ListResourcesResult } from './types'

type Status = 'idle' | 'loading' | 'ok' | 'forbidden' | 'error'

export function useK8sResource(
  clusterId: string,
  kind: string | null,
  namespace: string | undefined,
  opts: { pollMs?: number; paused?: boolean } = {},
) {
  const pollMs = opts.pollMs ?? 15000
  const paused = opts.paused ?? false

  const [items, setItems] = useState<ResourceListItem[]>([])
  const [truncated, setTruncated] = useState(false)
  const [status, setStatus] = useState<Status>('idle')
  const [errorMessage, setErrorMessage] = useState<string | undefined>()

  const abortRef = useRef<AbortController | null>(null)
  const errorStreak = useRef(0)
  const statusRef = useRef<Status>('idle')

  // Keep statusRef in sync so the polling tick closure can read it
  useEffect(() => { statusRef.current = status }, [status])

  const load = useCallback(async () => {
    if (!kind) return
    if (paused) return

    abortRef.current?.abort()
    const ac = new AbortController()
    abortRef.current = ac

    setStatus(prev => prev === 'idle' ? 'loading' : prev)

    try {
      const qs = new URLSearchParams({ kind })
      if (namespace) qs.set('namespace', namespace)
      const res = await fetch(
        `/api/v1/k8s/clusters/${clusterId}/resources?${qs.toString()}`,
        { signal: ac.signal },
      )
      const body = (await res.json()) as ListResourcesResult & { error?: string }

      // Guard: if this request was aborted (superseded by a newer load() call or
      // component unmount) after the fetch already resolved, drop the stale result.
      if (ac.signal.aborted) return

      if (!res.ok) {
        errorStreak.current++
        setStatus('error')
        setErrorMessage(body?.error ?? String(res.status))
        return
      }

      if (body.errorCode === 'forbidden') {
        setStatus('forbidden')
        setErrorMessage(body.errorMessage)
        return
      }

      if (body.errorCode) {
        errorStreak.current++
        setStatus('error')
        setErrorMessage(body.errorMessage)
        return
      }

      errorStreak.current = 0
      setItems(body.items ?? [])
      setTruncated(!!body.truncated)
      setStatus('ok')
      setErrorMessage(undefined)
    } catch (e: any) {
      if (e?.name === 'AbortError') return
      errorStreak.current++
      setStatus('error')
      setErrorMessage(e?.message)
    }
  }, [clusterId, kind, namespace, paused])

  // Initial fetch + re-fetch when deps change
  // Note: `kind` is already a dep of `load` (whose identity changes with `kind`), so it is
  // redundant in this array, but we keep the null-check to reset status when kind is cleared.
  useEffect(() => {
    if (!kind) {
      setStatus('idle')
      return
    }
    load()
  }, [load]) // eslint-disable-line react-hooks/exhaustive-deps

  // Polling interval
  useEffect(() => {
    if (!kind || pollMs <= 0) return

    const tick = () => {
      if (paused || document.hidden) return
      if (statusRef.current === 'forbidden') return
      if (errorStreak.current >= 3) return // refresh() bypasses this guard and is the recovery path
      load()
    }

    const t = setInterval(tick, pollMs)
    return () => clearInterval(t)
  }, [kind, pollMs, paused, load])

  // Abort on unmount
  useEffect(() => () => { abortRef.current?.abort() }, [])

  return { items, truncated, status, errorMessage, refresh: load }
}
