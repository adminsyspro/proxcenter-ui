import { useCallback, useEffect, useState } from 'react'

import type { LogCollectionRefusal, LogCollectionSettings, LogCollectionState } from '@/lib/logCollection/types'

/** What a write answered: done, or the refusal of the orchestrator as it came. */
/** `run` is set when the call started an installation or a removal on the nodes, which the state then follows. */
export type LogCollectionResult = { ok: true; run: boolean } | { ok: false; refusal: LogCollectionRefusal }

const base = (connectionId: string) => `/api/v1/connections/${encodeURIComponent(connectionId)}/log-collection`

async function refusalOf(res: Response): Promise<LogCollectionRefusal> {
  try {
    const body = await res.json()

    if (body && typeof body.code === 'string') return body as LogCollectionRefusal
  } catch {
    // Not JSON: a proxy answered in place of the application.
  }

  return { code: 'default', error: `HTTP ${res.status}` }
}

/**
 * The log collection of a cluster connection: its state, read when the tab
 * shows, after each write and every pollMs while a run is in flight, and the
 * writes themselves.
 */
export function useLogCollection(connectionId: string | undefined, active: boolean, pollMs = 2000) {
  const [state, setState] = useState<LogCollectionState | null>(null)
  const [loadError, setLoadError] = useState<LogCollectionRefusal | null>(null)
  const [pending, setPending] = useState(false)
  // Each increment asks for one more read.
  const [reads, setReads] = useState(0)
  const reload = useCallback(() => setReads(n => n + 1), [])

  useEffect(() => {
    if (!active || !connectionId) return
    // A read that a newer one, or the closing of the tab, made stale is dropped.
    let stale = false

    void (async () => {
      try {
        const res = await fetch(base(connectionId), { cache: 'no-store' })

        if (stale) return
        if (!res.ok) {
          setLoadError(await refusalOf(res))

          return
        }
        const next = (await res.json()) as LogCollectionState

        if (stale) return
        setState(next)
        setLoadError(null)
      } catch {
        if (!stale) setLoadError({ code: 'default', error: 'network' })
      }
    })()

    return () => {
      stale = true
    }
  }, [active, connectionId, reads])

  const busy = !!state?.busy

  useEffect(() => {
    if (!active || !busy) return
    const timer = setInterval(reload, pollMs)

    return () => clearInterval(timer)
  }, [active, busy, reload, pollMs])

  const write = useCallback(async (method: 'PUT' | 'POST', path: string, body?: unknown): Promise<LogCollectionResult> => {
    if (!connectionId) return { ok: false, refusal: { code: 'default', error: 'no connection' } }
    setPending(true)
    try {
      const res = await fetch(base(connectionId) + path, {
        method,
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      })

      if (!res.ok) return { ok: false, refusal: await refusalOf(res) }

      const answer: unknown = await res.json().catch(() => null)

      return { ok: true, run: typeof (answer as { run_id?: unknown } | null)?.run_id === 'string' }
    } catch {
      return { ok: false, refusal: { code: 'default', error: 'network' } }
    } finally {
      setPending(false)
      // Whatever the answer, what the orchestrator holds now is what shows.
      reload()
    }
  }, [connectionId, reload])

  const apply = useCallback((settings: LogCollectionSettings) => write('PUT', '', settings), [write])
  const retry = useCallback((node: string) => write('POST', `/nodes/${encodeURIComponent(node)}/retry`), [write])
  const check = useCallback(() => write('POST', '/check'), [write])

  return { state, loadError, pending, reload, apply, retry, check }
}
