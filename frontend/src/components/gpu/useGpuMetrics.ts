'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import type { GpuRange, VisibleGpuReading, VisibleSeries, VisibleVgpu, VisibleVgpuType } from '@/lib/gpu/metricsShared'

export type GpuLatest = {
  at: string
  gpus: VisibleGpuReading[]
  /** Running vGPUs of the hosts read over SSH, for the VMs the caller may see. */
  vgpus?: VisibleVgpu[]
  /** Profile catalog of the vGPU cards (what nvidia-<id> stands for). */
  vgpuTypes?: VisibleVgpuType[]
  probes: Array<{ connection_id: string; kind: 'guest' | 'host'; vmid?: number; node?: string; status: string; detail?: string; at: string; gpus: number }>
  enabled: boolean
  intervalSeconds: number
  thresholds: { util_pct: number; memory_pct: number; temp_c: number }
  configured: boolean
}

export type GpuSeriesData = { range: GpuRange; stepSeconds: number; from: number; to: number; series: VisibleSeries[] }

type State<T> = { data: T | null; error: string | null; loading: boolean }

async function read<T>(url: string, signal: AbortSignal): Promise<T> {
  const res = await fetch(url, { cache: 'no-store', signal })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw Object.assign(new Error(json?.error || `HTTP ${res.status}`), { code: json?.error })
  return json.data as T
}

/** Polls a GPU metrics route; the previous data stays on screen while a new read runs. */
function usePolled<T>(url: string | null, everyMs: number): State<T> & { refresh: () => void } {
  const [state, setState] = useState<State<T>>({ data: null, error: null, loading: !!url })
  const [tick, setTick] = useState(0)
  const urlRef = useRef(url)

  useEffect(() => {
    if (!url) return
    const changed = urlRef.current !== url
    urlRef.current = url
    const ctrl = new AbortController()
    setState(s => ({ data: changed ? null : s.data, error: null, loading: true }))
    read<T>(url, ctrl.signal)
      .then(data => setState({ data, error: null, loading: false }))
      .catch((e: any) => {
        if (ctrl.signal.aborted) return
        setState(s => ({ data: s.data, error: e?.code || e?.message || String(e), loading: false }))
      })
    const timer = setTimeout(() => setTick(n => n + 1), everyMs)
    return () => {
      ctrl.abort()
      clearTimeout(timer)
    }
  }, [url, everyMs, tick])

  const refresh = useCallback(() => setTick(n => n + 1), [])
  return { ...state, refresh }
}

/** The latest GPU readings, re-read every 30 s (the collector reads every minute by default). */
export function useGpuLatest(enabled = true) {
  return usePolled<GpuLatest>(enabled ? '/api/v1/gpu/metrics/latest' : null, 30_000)
}

/** The bucketed history of the range, re-read every minute. */
export function useGpuSeries(range: GpuRange, enabled = true) {
  return usePolled<GpuSeriesData>(enabled ? `/api/v1/gpu/metrics/series?range=${range}` : null, 60_000)
}
