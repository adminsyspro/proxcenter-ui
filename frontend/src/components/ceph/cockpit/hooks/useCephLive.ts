'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { usePageVisible } from '@/hooks/usePageVisibility'
import { useSelectionGuard } from '@/hooks/useSelectionGuard'
import { isCephLive } from '@/lib/ceph/shape'
import type { CephLive } from '@/lib/ceph/types'

import { fetchCockpitShaped, isNotFound } from './cockpitFetch'

export const LIVE_INTERVAL_MS = 5000
export const LIVE_BUFFER_SIZE = 720
export const LIVE_TIMEOUT_MS = 10_000

interface LiveState {
  conn: string | null
  live: CephLive | null
  buffer: CephLive[]
  error: Error | null
  lastOkAt: number | null
  absent: boolean
}

const EMPTY = (conn: string | null): LiveState => ({ conn, live: null, buffer: [], error: null, lastOkAt: null, absent: false })

/**
 * Live Ceph a 5 s, en pause quand l'onglet est cache (0 appel). Tampon circulaire d'1 h.
 * Les reponses d'une ancienne selection sont ecartees ; en cas d'erreur ou de delai depasse (10 s)
 * la derniere valeur reste (`stale`). Un 404 (pas de Ceph) arrete le sondage (`absent`).
 * `refresh()` relit tout de suite et relance le sondage, meme apres un 404.
 */
export function useCephLive(conn: string | null, enabled: boolean) {
  const visible = usePageVisible()
  const guard = useSelectionGuard(conn)
  const [state, setState] = useState<LiveState>(() => EMPTY(conn))
  const inFlight = useRef<string | null>(null)
  const [nonce, setNonce] = useState(0)
  const absent = state.conn === conn && state.absent

  const refresh = useCallback(() => {
    setState(prev => (prev.conn === conn && prev.absent ? { ...prev, absent: false } : prev))
    setNonce(n => n + 1)
  }, [conn])

  useEffect(() => {
    if (!conn || !enabled || !visible || absent) return

    const url = `/api/v1/connections/${encodeURIComponent(conn)}/ceph/live`

    const tick = async () => {
      if (inFlight.current === conn) return
      const req = guard.begin(conn)

      // Selection deja depassee : on n'envoie rien.
      if (req.signal.aborted) return
      inFlight.current = conn
      const timeout = new AbortController()
      const onAbort = () => timeout.abort()
      const timer = setTimeout(onAbort, LIVE_TIMEOUT_MS)

      req.signal.addEventListener('abort', onAbort)

      try {
        const live = await fetchCockpitShaped(url, isCephLive, timeout.signal)

        if (!req.isCurrent()) return
        setState(prev => {
          const base = prev.conn === conn ? prev : EMPTY(conn)

          return { conn, live, buffer: [...base.buffer, live].slice(-LIVE_BUFFER_SIZE), error: null, lastOkAt: Date.now(), absent: false }
        })
      } catch (e) {
        if (!req.isCurrent()) return
        setState(prev => {
          const base = prev.conn === conn ? prev : EMPTY(conn)

          return isNotFound(e)
            ? { ...base, error: null, absent: true }
            : { ...base, error: e instanceof Error ? e : new Error(String(e)) }
        })
      } finally {
        clearTimeout(timer)
        req.signal.removeEventListener('abort', onAbort)
        if (inFlight.current === conn) inFlight.current = null
      }
    }

    void tick()
    const id = setInterval(() => void tick(), LIVE_INTERVAL_MS)

    return () => clearInterval(id)
  }, [conn, enabled, visible, absent, guard, nonce])

  const cur = state.conn === conn ? state : EMPTY(conn)

  return {
    live: cur.live,
    buffer: cur.buffer,
    error: cur.error,
    lastOkAt: cur.lastOkAt,
    absent: cur.absent,
    stale: cur.error !== null && cur.live !== null,
    refresh,
  }
}
