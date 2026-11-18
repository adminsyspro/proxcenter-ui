'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

import { MicrosegApiError, microsegApi } from '@/lib/microseg/api'
import type { GroupRun, MicrosegRun, MicrosegStatus } from '@/lib/microseg/types'
import { FATAL_CODES, useMicrosegRun } from '@/lib/microseg/useMicroseg'

import { CHECK_RUNS_LIMIT, findCheckCandidate, findCompanions, isCheckRun, type CheckCompanions, type CheckCutoff } from './checkModel'
import { useGroupRunPoll } from './useGroupRunPoll'

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

/** Where the check of one cluster of a shared policy stands, until its run is found. */
export type ClusterCheck = {
  connection_id: string
  /** `sending` the request, `queued` in the engine's queue, `searching` its run, `found` it, `failed` to ask or to find it. */
  phase: 'sending' | 'queued' | 'searching' | 'found' | 'failed'
  runId?: string
  /** Why it failed: an error of the request or of the reads, or `lost` (the run was not found in time). */
  error?: unknown
  /** The last read of its status or its runs failed (still retried, as `pollError` of one cluster); null once one works. */
  pollError?: unknown
}

type GroupOptions = {
  /** The active clusters of the policy (a link not applied yet answers 404 to a check: it is not asked). */
  activeIds: readonly string[]
  /** Every cluster has its run, or failed: follow them as one group run in the strip. */
  onTracked: (runs: GroupRun[]) => void
  /** Every run has ended: refresh what they may have changed. */
  onDone: () => void
}

/** Waits `ms`, then for the tab to be shown (nothing is read while it is hidden); resolves false once cancelled. */
function pause(ms: number, cancelled: () => boolean): Promise<boolean> {
  return new Promise(resolve => {
    setTimeout(() => {
      if (cancelled()) return resolve(false)
      if (typeof document === 'undefined' || !document.hidden) return resolve(true)
      const onVisible = () => {
        if (document.hidden) return
        document.removeEventListener('visibilitychange', onVisible)
        resolve(!cancelled())
      }
      document.addEventListener('visibilitychange', onVisible)
    }, ms)
  })
}

/**
 * Finds the run of a check asked on one cluster: reads its status every 5 s while the check is queued (the engine's
 * memory, no Proxmox call), then its runs list every 2 s, one read in flight, until the run is found or a minute has
 * passed. Resolves with the run ID, or throws (`lost` past the minute).
 */
async function findClusterCheck(
  connId: string, cutoff: CheckCutoff, cancelled: () => boolean,
  onPhase: (phase: ClusterCheck['phase']) => void, reportPollError: (error: unknown) => void,
): Promise<string | null> {
  const api = microsegApi(connId)
  // Told only when it changes: a read that keeps working redraws nothing.
  let shown: unknown = null
  const onPollError = (error: unknown) => {
    if (error === shown) return
    shown = error
    reportPollError(error)
  }
  // Queued: the run does not exist yet. No time limit here, as for one cluster: the engine takes it at its next pass.
  for (;;) {
    if (cancelled()) return null
    let status: MicrosegStatus | null = null
    try {
      status = await api.getStatus()
      onPollError(null)
    } catch (e) {
      if (isFatal(e)) throw e
      onPollError(e)
    }
    if (status && status.engine.check_pending !== true) break
    if (!(await pause(CHECK_STATUS_POLL_MS, cancelled))) return null
  }
  onPhase('searching')
  const exclude = new Set(cutoff.exclude)
  const begun = Date.now()
  for (;;) {
    if (cancelled()) return null
    try {
      const candidate = findCheckCandidate((await api.listRuns({ limit: CHECK_RUNS_LIMIT })).runs, { since: cutoff.since, exclude })
      if (candidate) {
        const detail = await api.getRun(candidate.id)
        if (isCheckRun(detail)) return detail.id
        exclude.add(detail.id)
      }
      onPollError(null)
    } catch (e) {
      if (isFatal(e)) throw e
      onPollError(e)
    }
    if (Date.now() - begun > CHECK_FIND_TIMEOUT_MS) throw new Error('lost')
    if (!(await pause(CHECK_FIND_POLL_MS, cancelled))) return null
  }
}

/** The request of a check on one cluster: the cutoff its run is looked for after (a 409 means one is queued already). */
async function askCheck(connId: string): Promise<CheckCutoff> {
  try {
    const queued = await microsegApi(connId).checkNow()
    return { since: queued.requested_at, exclude: new Set() }
  } catch (e) {
    if (!(e instanceof MicrosegApiError && e.code === 'CHECK_PENDING')) throw e
    return { since: null, exclude: await fullRunsNow(connId) }
  }
}

/**
 * "Check now" on a shared policy: a check is queued on every active cluster at once, each through its own relay; the run
 * of each is looked for on its cluster, then they are followed together as one group run (the strip, and this hook for
 * the window). A cluster whose check could not be asked or found ends as failed, the others go on.
 */
export function useGroupCheck({ activeIds, onTracked, onDone }: GroupOptions) {
  const [clusters, setClusters] = useState<ClusterCheck[]>([])
  const [runs, setRuns] = useState<GroupRun[] | null>(null)
  const session = useRef(0)
  const callbacks = useRef({ onTracked, onDone })
  useEffect(() => { callbacks.current = { onTracked, onDone } })
  // Unmounted: every loop of the current session stops.
  useEffect(() => () => { session.current += 1 }, [])

  const start = useCallback(async () => {
    const id = ++session.current
    const cancelled = () => session.current !== id
    const ids = [...activeIds]
    setRuns(null)
    setClusters(ids.map(connection_id => ({ connection_id, phase: 'sending' })))
    const update = (connId: string, next: Partial<ClusterCheck>) => {
      if (!cancelled()) setClusters(prev => prev.map(c => (c.connection_id === connId ? { ...c, ...next } : c)))
    }
    const outcomes = await Promise.all(ids.map(async (connId): Promise<GroupRun> => {
      try {
        const cutoff = await askCheck(connId)
        update(connId, { phase: 'queued' })
        const runId = await findClusterCheck(connId, cutoff, cancelled, phase => update(connId, { phase }), pollError => update(connId, { pollError }))
        if (!runId) return { connection_id: connId, error: 'internal' }
        update(connId, { phase: 'found', runId })
        return { connection_id: connId, run_id: runId }
      } catch (e) {
        update(connId, { phase: 'failed', error: e })
        return { connection_id: connId, error: 'internal' }
      }
    }))
    if (cancelled()) return
    setRuns(outcomes)
    if (outcomes.some(r => r.run_id)) callbacks.current.onTracked(outcomes)
  }, [activeIds])

  const polled = useGroupRunPoll(runs)
  const done = runs !== null && polled.every(p => p.ended)
  const doneKey = done && runs ? runs.map(r => r.run_id ?? '').join(',') : ''
  useEffect(() => {
    if (doneKey) callbacks.current.onDone()
  }, [doneKey])

  const started = clusters.length > 0
  return { clusters, runs, polled, done, active: started && !done, started, start }
}

export type GroupCheck = ReturnType<typeof useGroupCheck>
