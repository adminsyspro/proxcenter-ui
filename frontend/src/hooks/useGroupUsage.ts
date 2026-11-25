import { useCallback, useEffect, useRef, useState } from 'react'

import type { GroupUsage } from '@/lib/firewall/groupUsage'

import { COVERAGE_POLL_MS } from './useZeroTrust'

export type { GroupUsage, UsageMember } from '@/lib/firewall/groupUsage'

export function groupUsageUrl(connectionId: string): string {
  return `/api/v1/firewall/group-usage/${encodeURIComponent(connectionId)}`
}

/**
 * Which guests carry which security group, read by the server under its own bounds (lib/firewall/groupUsage.ts).
 * While the server computes, it is asked again every COVERAGE_POLL_MS: each read joins its computation, no new
 * Proxmox call. `all` asks for every guest instead of the 200-guest sample, `force` for rules read again.
 */
export async function readGroupUsage(
  connectionId: string,
  opts: { force?: boolean; all?: boolean; signal?: AbortSignal; pollMs?: number } = {},
): Promise<GroupUsage> {
  const query = new URLSearchParams()
  if (opts.all) query.set('all', '1')
  if (opts.force) query.set('refresh', '1')

  for (;;) {
    const suffix = query.size > 0 ? `?${query}` : ''
    const res = await fetch(`${groupUsageUrl(connectionId)}${suffix}`, { cache: 'no-store', signal: opts.signal })
    const body = await res.json().catch(() => null)
    if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`)
    if (!body?.computing) return body as GroupUsage
    // The read asked for is running on the server: the next requests only wait for it.
    query.delete('refresh')
    await new Promise(resolve => setTimeout(resolve, opts.pollMs ?? COVERAGE_POLL_MS))
  }
}

interface UseGroupUsageReturn {
  /** Null until read, and when the read failed. */
  usage: GroupUsage | null
  loading: boolean
  error: string | null
  /** Reads again; `force` asks the server for rules read again. */
  reload: (force?: boolean) => Promise<void>
  /** Every guest, read again: the check made before a group is deleted. Throws when it cannot be read. */
  check: () => Promise<GroupUsage>
}

/**
 * The security group usage of a connection, read each time `enabled` turns true (the Security Groups tab is shown)
 * and again on `reload`; never on an interval.
 */
export function useGroupUsage(connectionId: string | null, enabled: boolean): UseGroupUsageReturn {
  const [usage, setUsage] = useState<GroupUsage | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // The connection read since the tab was last shown: coming back to the tab reads again (the server answers from
  // what it keeps unless something wrote meanwhile, so this costs Proxmox nothing).
  const readFor = useRef<string | null>(null)

  const latest = useRef(0)
  const controller = useRef<AbortController | null>(null)
  useEffect(() => () => controller.current?.abort(), [])

  // Another connection starts from nothing (adjusted while rendering, not in an effect).
  const [shownConnection, setShownConnection] = useState(connectionId)
  if (shownConnection !== connectionId) {
    setShownConnection(connectionId)
    setUsage(null)
    setLoading(false)
    setError(null)
  }

  const read = useCallback(async (opts: { force?: boolean; all?: boolean }) => {
    if (!connectionId) throw new Error('no connection')
    const id = ++latest.current
    controller.current?.abort()
    const abort = new AbortController()
    controller.current = abort
    setLoading(true)

    try {
      const answer = await readGroupUsage(connectionId, { ...opts, signal: abort.signal })
      if (latest.current === id) {
        setUsage(answer)
        setError(null)
      }

      return answer
    } catch (err) {
      if (latest.current === id && (err as { name?: string })?.name !== 'AbortError') {
        setUsage(null)
        setError(err instanceof Error ? err.message : String(err))
      }
      throw err
    } finally {
      if (latest.current === id) setLoading(false)
    }
  }, [connectionId])

  const reload = useCallback(async (force = false) => {
    await read({ force }).catch(() => undefined)
  }, [read])

  // The check is a read of its own: a reload of the tab never aborts it, and two checks asked at once share the
  // server's read. Its answer also becomes what the tab shows, unless the connection changed meanwhile.
  const shown = useRef(connectionId)
  useEffect(() => { shown.current = connectionId }, [connectionId])
  const check = useCallback(async () => {
    if (!connectionId) throw new Error('no connection')
    const answer = await readGroupUsage(connectionId, { force: true, all: true })
    if (shown.current === connectionId) {
      latest.current++
      setUsage(answer)
      setError(null)
      setLoading(false)
    }

    return answer
  }, [connectionId])

  useEffect(() => {
    if (!enabled || !connectionId) {
      readFor.current = null
      return
    }
    if (readFor.current === connectionId) return
    readFor.current = connectionId
    void reload()
  }, [enabled, connectionId, reload])

  return { usage, loading, error, reload, check }
}
