'use client'

import { createContext, useCallback, useContext, useMemo, useState } from 'react'

import type { TrackedRun } from './microsegTabTypes'

/** What the page knows of the runs that write Proxmox and have not ended. */
export type RunsInProgress = {
  /** A zone state change, a plan, a restore or a removal is being written. */
  applying: boolean
  /** The zones whose state change is being written. */
  zones: ReadonlySet<string>
}

const NO_ZONE: ReadonlySet<string> = new Set()
const IDLE: RunsInProgress = { applying: false, zones: NO_ZONE }

/** The kinds of tracked run that write the draft to Proxmox (a check only reads and repairs). */
const WRITING_KINDS: ReadonlySet<string> = new Set(['zoneState', 'apply', 'restore', 'remove'])

const RunsInProgressContext = createContext<RunsInProgress>(IDLE)

export const RunsInProgressProvider = RunsInProgressContext.Provider

/** Idle outside a provider: a component drawn alone shows nothing in progress. */
export const useRunsInProgress = () => useContext(RunsInProgressContext)

export function runsInProgress(runs: readonly TrackedRun[], ended: ReadonlySet<string>): RunsInProgress {
  const writing = runs.filter(r => WRITING_KINDS.has(r.kind) && !ended.has(r.runId))
  if (writing.length === 0) return IDLE
  return { applying: true, zones: new Set(writing.flatMap(r => (r.zoneId ? [r.zoneId] : []))) }
}

/**
 * The runs a page follows in its strip. They live above the sub-tabs, so switching sub-tab does not lose them,
 * and the page knows which ones have not ended: the pending changes and the zones say so meanwhile.
 */
export function useTrackedRuns() {
  const [runs, setRuns] = useState<TrackedRun[]>([])
  const [ended, setEnded] = useState<ReadonlySet<string>>(NO_ZONE)

  const startRun = useCallback((run: TrackedRun) => {
    setRuns(prev => (prev.some(r => r.runId === run.runId) ? prev : [...prev, run]))
  }, [])
  const endRun = useCallback((runId: string) => {
    setEnded(prev => (prev.has(runId) ? prev : new Set(prev).add(runId)))
  }, [])
  const removeRun = useCallback((runId: string) => {
    setRuns(prev => prev.filter(r => r.runId !== runId))
    setEnded(prev => {
      if (!prev.has(runId)) return prev
      const next = new Set(prev)
      next.delete(runId)
      return next
    })
  }, [])
  const inProgress = useMemo(() => runsInProgress(runs, ended), [runs, ended])

  return { runs, startRun, endRun, removeRun, inProgress }
}
