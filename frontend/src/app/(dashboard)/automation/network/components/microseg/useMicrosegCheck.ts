'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { MicrosegApiError, microsegApi } from '@/lib/microseg/api'
import type { MicrosegRun, MicrosegStatus } from '@/lib/microseg/types'
import { FATAL_CODES, useMicrosegRun } from '@/lib/microseg/useMicroseg'

import { CHECK_RUNS_LIMIT, findCheckCandidate, findCompanions, isCheckRun, type CheckCompanions, type CheckCutoff } from './checkModel'

/** While the check is queued the shared status is read every 5 s (from the engine's memory: no Proxmox call). */
export const CHECK_STATUS_POLL_MS = 5000
/** Once the engine has taken the check its run is recorded at once: the runs list is read every 2 s. */
export const CHECK_FIND_POLL_MS = 2000
/** Past this, after the engine took the check, the run is said lost (History still lists it). */
export const CHECK_FIND_TIMEOUT_MS = 60_000
/** The log read follows the full run in the same pass and is recorded when it ends: it is looked for a few times. */
export const COMPANION_TRIES = 5
export const COMPANION_RETRY_MS = 3000

export type CheckPhase =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'queued'; cutoff: CheckCutoff }
  | { kind: 'tracking'; runId: string }
  | { kind: 'lost' }
  | { kind: 'error'; error: unknown }

const NO_COMPANIONS: CheckCompanions = { ipsReady: false, ips: null, logReady: false, log: null }

const isFatal = (e: unknown) => e instanceof MicrosegApiError && FATAL_CODES.has(e.code)

type Options = {
  connectionId: string
  /** The shared status of the tab (GET /status): `check_pending` says the check still waits in the queue. */
  status: MicrosegStatus | undefined
  statusError: unknown
  reloadStatus: () => Promise<unknown>
  /** True while the check waits in the queue: the tab then reads the status every 5 s. */
  onQueued: (queued: boolean) => void
  /** The run of the check has been found: follow it in the strip like any other run. */
  onTracked: (runId: string) => void
  /** The run of the check has ended: refresh what it may have changed. */
  onDone: () => void
}

/** The full runs listed now: after a 409 the check has not started, so none of them is its run. */
async function fullRunsNow(connectionId: string): Promise<Set<string>> {
  const { runs } = await microsegApi(connectionId).listRuns({ limit: CHECK_RUNS_LIMIT })
  return new Set(runs.filter(run => run.kind === 'full').map(run => run.id))
}

/**
 * Once the engine has taken the check (the shared status no longer says it is queued), looks for its run in the runs
 * list every 2 s, and gives up after a minute.
 */
function useRunSearch(connectionId: string, cutoff: CheckCutoff | null, found: (runId: string) => void, fail: (phase: CheckPhase) => void) {
  const [searchError, setSearchError] = useState<unknown>(null)

  useEffect(() => {
    if (!cutoff) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const api = microsegApi(connectionId)
    const { since } = cutoff
    const exclude = new Set(cutoff.exclude)
    const begun = Date.now()

    async function look(): Promise<string | null> {
      const { runs } = await api.listRuns({ limit: CHECK_RUNS_LIMIT })
      const candidate = cancelled ? null : findCheckCandidate(runs, { since, exclude })
      if (!candidate) return null
      const detail = await api.getRun(candidate.id)
      if (isCheckRun(detail)) return detail.id
      // An ended full run of another trigger: never the check's.
      exclude.add(detail.id)
      return null
    }

    async function tick() {
      try {
        const runId = await look()
        if (cancelled) return
        setSearchError(null)
        if (runId) return found(runId)
      } catch (e) {
        if (cancelled) return
        if (isFatal(e)) return fail({ kind: 'error', error: e })
        setSearchError(e)
      }
      if (Date.now() - begun > CHECK_FIND_TIMEOUT_MS) return fail({ kind: 'lost' })
      timer = setTimeout(tick, CHECK_FIND_POLL_MS)
    }
    void tick()

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [connectionId, cutoff, found, fail])

  return cutoff ? searchError : null
}

/** The IP collection and the log read of the pass of a finished check run. */
function useCompanions(connectionId: string, finished: MicrosegRun | null): CheckCompanions {
  const [state, setState] = useState<{ runId: string | null; value: CheckCompanions }>({ runId: null, value: NO_COMPANIONS })

  useEffect(() => {
    if (!finished) return
    const full = finished
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const api = microsegApi(connectionId)
    const detail = (run: MicrosegRun | null) => (run ? api.getRun(run.id).catch(() => null) : Promise.resolve(null))
    let tries = 0
    let value: CheckCompanions = NO_COMPANIONS

    async function look() {
      tries += 1
      let listed: ReturnType<typeof findCompanions> = { ips: null, log: null }
      try {
        listed = findCompanions((await api.listRuns({ limit: CHECK_RUNS_LIMIT })).runs, full)
      } catch {
        // Not listed: the rows say the figure was not measured.
      }
      if (cancelled) return
      if (!value.ipsReady) value = { ...value, ipsReady: true, ips: await detail(listed.ips) }
      // A log read not found yet, or not ended, is looked for again (it is recorded once it has ended).
      const log = await detail(listed.log)
      if (cancelled) return
      if ((log && log.status !== 'running') || tries >= COMPANION_TRIES) value = { ...value, logReady: true, log }
      setState({ runId: full.id, value })
      if (!value.logReady) timer = setTimeout(look, COMPANION_RETRY_MS)
    }
    void look()

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [connectionId, finished])

  return finished && state.runId === finished.id ? state.value : NO_COMPANIONS
}

/**
 * The manual check of a connection: the request, the wait in the queue of the engine (up to a minute, read from the
 * shared status of the tab, refreshed faster meanwhile), then its full run, and the runs of the same pass for the
 * figures of the outcome.
 */
export function useMicrosegCheck({ connectionId, status, statusError, reloadStatus, onQueued, onTracked, onDone }: Options) {
  const [phase, setPhase] = useState<CheckPhase>({ kind: 'idle' })
  // A new request makes the answers of the previous one stale.
  const session = useRef(0)
  const callbacks = useRef({ onQueued, onTracked, onDone, reloadStatus })
  useEffect(() => { callbacks.current = { onQueued, onTracked, onDone, reloadStatus } })

  const start = useCallback(async () => {
    const id = ++session.current
    const current = () => session.current === id
    setPhase({ kind: 'sending' })
    let cutoff: CheckCutoff
    try {
      const queued = await microsegApi(connectionId).checkNow()
      cutoff = { since: queued.requested_at, exclude: new Set() }
    } catch (e) {
      if (!current()) return
      if (!(e instanceof MicrosegApiError && e.code === 'CHECK_PENDING')) return setPhase({ kind: 'error', error: e })
      // A check is already queued (another admin, another window): its run is the next full run.
      try {
        cutoff = { since: null, exclude: await fullRunsNow(connectionId) }
      } catch (listError) {
        if (current()) setPhase({ kind: 'error', error: listError })
        return
      }
    }
    // The status read after the request says whether the check is still queued (and the button says so).
    await callbacks.current.reloadStatus()
    if (current()) setPhase({ kind: 'queued', cutoff })
  }, [connectionId])

  const found = useCallback((runId: string) => {
    setPhase({ kind: 'tracking', runId })
    callbacks.current.onTracked(runId)
  }, [])
  const fail = useCallback((next: CheckPhase) => setPhase(next), [])

  const queued = phase.kind === 'queued'
  // The tab reads the status faster while the check waits in the queue.
  useEffect(() => {
    if (!queued) return
    callbacks.current.onQueued(true)
    return () => callbacks.current.onQueued(false)
  }, [queued])

  // An orchestrator without the field never says the check is queued: its run is looked for at once.
  const taken = queued && status?.engine.check_pending !== true
  const cutoff = taken ? phase.cutoff : null
  const searchError = useRunSearch(connectionId, cutoff, found, fail)
  const pollError = queued ? searchError ?? statusError ?? null : null

  const runId = phase.kind === 'tracking' ? phase.runId : null
  const { run, done, error: runError } = useMicrosegRun(connectionId, runId)
  const finished = done ? run : null
  const companions = useCompanions(connectionId, finished)

  const finishedId = finished?.id
  useEffect(() => {
    if (finishedId) callbacks.current.onDone()
  }, [finishedId])

  // Still going: a click on the button reopens the window instead of asking again.
  const active = phase.kind === 'sending' || queued || (phase.kind === 'tracking' && !done)

  return { phase, pollError, run, done, runError, companions, active, start }
}

export type MicrosegCheck = ReturnType<typeof useMicrosegCheck>
