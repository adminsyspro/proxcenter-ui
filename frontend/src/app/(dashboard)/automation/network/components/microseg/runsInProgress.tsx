'use client'

import { createContext, useCallback, useContext, useMemo, useState } from 'react'

import { groupRuns } from '@/lib/microseg/groupRuns'
import type { RunStarted } from '@/lib/microseg/types'

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

/** The run IDs a tracked line follows: its own and those of every cluster. */
function runIds(run: TrackedRun): string[] {
  return [run.runId, ...(run.runs ?? []).flatMap(r => (r.run_id ? [r.run_id] : []))]
}

/**
 * What a lifecycle answer gives a tracked run: the run of the tab's connection alone, exactly as before the shared
 * policies, or the run of each cluster. The line is keyed by the run of the tab's connection, else by the first run
 * that started.
 */
export function startedRuns(started: RunStarted, connectionId: string): Pick<TrackedRun, 'runId' | 'runs'> {
  const runs = groupRuns(started, connectionId)
  const only = runs.length === 1 ? runs[0] : null
  if (only && !only.error && only.connection_id === connectionId && (only.run_id ?? started.run_id) === started.run_id) return { runId: started.run_id }
  const runId = started.run_id || runs.find(r => r.run_id)?.run_id || runs.map(r => `${r.connection_id}:${r.error ?? ''}`).join(',')
  return { runId, runs }
}

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
    // A run already followed (by its own line or as one cluster of a group line) is not followed twice.
    const ids = new Set(runIds(run))
    setRuns(prev => (prev.some(r => runIds(r).some(id => ids.has(id))) ? prev : [...prev, run]))
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
