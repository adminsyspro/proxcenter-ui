'use client'

import { useCallback, useEffect, useState } from 'react'

import type { GpuReport } from '@/lib/gpu/report'

export type GpuReportState = {
  report: GpuReport | null
  loading: boolean
  error: string | null
  refresh: () => void
}

type Loaded = { base: string; request: string; report: GpuReport | null; error: string | null }

/** Reads /api/v1/gpu for one scope: everything, one cluster, or one node of it. */
export function useGpuReport(connId?: string | null, node?: string | null): GpuReportState {
  const [refreshes, setRefreshes] = useState(0)
  const [loaded, setLoaded] = useState<Loaded>({ base: '', request: '', report: null, error: null })

  const params = new URLSearchParams()
  if (connId) params.set('connId', connId)
  if (node) params.set('node', node)
  const base = `/api/v1/gpu${params.size ? `?${params}` : ''}`
  // The first read of a scope may come from the server cache, every Refresh click bypasses it.
  const url = refreshes > 0 ? `${base}${params.size ? '&' : '?'}refresh=1` : base
  const request = `${url}#${refreshes}`

  useEffect(() => {
    let cancelled = false
    fetch(url, { cache: 'no-store' })
      .then(async (res) => {
        const json = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(json?.error || `HTTP ${res.status}`)
        if (!cancelled) setLoaded({ base, request, report: json?.data ?? null, error: null })
      })
      .catch((e: any) => {
        if (!cancelled) setLoaded((prev) => ({ base, request, report: prev.base === base ? prev.report : null, error: e?.message || String(e) }))
      })
    return () => {
      cancelled = true
    }
  }, [base, url, request])

  const refresh = useCallback(() => setRefreshes((n) => n + 1), [])

  // A report of another scope (the selection moved) is never shown.
  const current = loaded.base === base
  return {
    report: current ? loaded.report : null,
    loading: loaded.request !== request,
    error: current ? loaded.error : null,
    refresh,
  }
}
