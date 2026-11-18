'use client'

import { useEffect, useMemo, useState } from 'react'

import { MicrosegApiError, microsegApi } from '@/lib/microseg/api'
import { groupOutcome } from '@/lib/microseg/groupRuns'
import { FATAL_CODES, RUN_POLL_MS, isRunFinished, runRetryDelay } from '@/lib/microseg/useMicroseg'
import type { GroupRun, MicrosegRun } from '@/lib/microseg/types'

/** The run of one cluster of a group action, as far as its reads went. */
export type PolledRun = GroupRun & {
  /** The last answer (null before the first one, and for a cluster whose run did not start). */
  run: MicrosegRun | null
  /** The last failed read: the run is still followed unless the error is fatal. */
  readError: Error | null
  /**
   * Its reads failed for good (a fatal code such as 403 or 404, or, on a group, RUN_READ_MAX_FAILURES failures in a
   * row): it is no longer followed, ends and counts as failed.
   */
  fatal: boolean
  /**
   * The run was given up after RUN_READ_MAX_FAILURES failed reads: a verdict of this page only, the run may still end
   * on the server. Its status is unknown, which the line says (unlike a run the server refuses to show, 403 or 404).
   */
  abandoned: boolean
  /** The run has ended, never started (`error` code of the lifecycle answer), or cannot be read any more. */
  ended: boolean
}

type Reads = Record<string, { run: MicrosegRun | null; readError: Error | null; fatal?: boolean; abandoned?: boolean }>

/** The failed reads in a row after which the run of one cluster of a group is given up (about two minutes of retries). */
export const RUN_READ_MAX_FAILURES = 8

/** Where the polled runs of a group stand together: a cluster whose run did not start counts as not applied. */
export function polledOutcome(polled: readonly PolledRun[]) {
  return groupOutcome(polled.map(p => (p.run_id && !p.fatal ? p.run ?? RUNNING : FAILED)) as MicrosegRun[])
}
const RUNNING = { status: 'running' }
const FAILED = { status: 'failed' }

const keyOf = (r: GroupRun) => `${r.connection_id}/${r.run_id ?? ''}`

/**
 * Follows the run of each cluster a group action started, each through its own cluster's relay (per-cluster rights):
 * read at once, then every 2 s after the answer came back (one read in flight per cluster), a curable failure retried
 * later and later, a fatal one stops that cluster. A cluster whose run did not start is not read. With several
 * clusters, nothing is read while the browser tab is hidden; the reads resume when it is shown. One cluster is read
 * as `useMicrosegRun` reads it.
 */
export function useGroupRunPoll(entries: readonly GroupRun[] | null): PolledRun[] {
  const key = entries && entries.length > 0 ? JSON.stringify(entries.map(r => [r.connection_id, r.run_id ?? '', r.error ?? ''])) : ''
  // The entries are read through their key: a caller handing a new array of the same runs does not restart the reads.
  const list = useMemo<GroupRun[]>(() => (key ? (JSON.parse(key) as [string, string, string][]).map(([connection_id, runId, error]) => ({
    connection_id, ...(runId ? { run_id: runId } : {}), ...(error ? { error } : {}),
  })) : []), [key])
  const [state, setState] = useState<{ key: string; reads: Reads }>({ key: '', reads: {} })

  useEffect(() => {
    const followed = list.filter(r => r.run_id && !r.error)
    if (followed.length === 0) return
    let cancelled = false
    const controller = new AbortController()
    const timers = new Set<ReturnType<typeof setTimeout>>()
    // A group action pauses while the tab is hidden and gives a cluster up after many failures; one cluster is read
    // as it always was.
    const pauseWhenHidden = list.length > 1
    const maxFailures = list.length > 1 ? RUN_READ_MAX_FAILURES : Infinity
    // The reads put off while the tab was hidden, started again when it is shown.
    const parked = new Set<() => void>()
    const later = (fn: () => void, ms: number) => {
      const timer = setTimeout(() => { timers.delete(timer); fn() }, ms)
      timers.add(timer)
    }
    const write = (k: string, read: Reads[string]) =>
      setState(prev => ({ key, reads: { ...(prev.key === key ? prev.reads : {}), [k]: read } }))

    for (const entry of followed) {
      const k = keyOf(entry)
      const api = microsegApi(entry.connection_id)
      let failures = 0
      let last: MicrosegRun | null = null
      const tick = async () => {
        if (cancelled) return
        if (pauseWhenHidden && typeof document !== 'undefined' && document.hidden) {
          parked.add(tick)
          return
        }
        let next: MicrosegRun
        try {
          next = await api.getRun(entry.run_id!, controller.signal)
        } catch (e) {
          if (cancelled) return
          failures += 1
          const refused = e instanceof MicrosegApiError && FATAL_CODES.has(e.code)
          const abandoned = !refused && failures >= maxFailures
          const fatal = refused || abandoned
          write(k, { run: last, readError: e as Error, fatal, abandoned })
          if (fatal) return
          later(() => void tick(), runRetryDelay(failures))
          return
        }
        if (cancelled) return
        failures = 0
        last = next
        write(k, { run: next, readError: null })
        if (!isRunFinished(next)) later(() => void tick(), RUN_POLL_MS)
      }
      void tick()
    }

    const onVisible = () => {
      if (document.hidden) return
      const resume = [...parked]
      parked.clear()
      for (const tick of resume) void tick()
    }
    if (pauseWhenHidden) document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      controller.abort()
      for (const timer of timers) clearTimeout(timer)
      if (pauseWhenHidden) document.removeEventListener('visibilitychange', onVisible)
    }
  }, [list, key])

  return useMemo(() => {
    // The reads of an earlier set of runs are never shown for this one.
    const reads = state.key === key ? state.reads : {}
    return list.map(entry => {
      const read = reads[keyOf(entry)]
      const run = read?.run ?? null
      const fatal = !!read?.fatal
      return { ...entry, run, readError: read?.readError ?? null, fatal, abandoned: !!read?.abandoned, ended: fatal || !!entry.error || !entry.run_id || isRunFinished(run) }
    })
  }, [list, key, state])
}
