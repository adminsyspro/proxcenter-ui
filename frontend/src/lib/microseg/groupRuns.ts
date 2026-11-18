// src/lib/microseg/groupRuns.ts

import type { GroupRun, MicrosegRun, RunStarted } from './types'

/** The run of each cluster a lifecycle call started; an answer without `runs` (one cluster) gives one entry. */
export function groupRuns(started: RunStarted, fallbackConnId: string): GroupRun[] {
  return started.runs ?? [{ connection_id: fallbackConnId, run_id: started.run_id }]
}

/** Where the runs of a group stand together: running, done, failed or a mix of both; no run at all is `failed`, never a success. */
export function groupOutcome(runs: readonly MicrosegRun[]): 'running' | 'done' | 'failed' | 'partial' {
  if (runs.some(r => r.status === 'running')) return 'running'
  if (runs.length === 0) return 'failed'
  const failed = runs.filter(r => r.status === 'failed').length
  if (failed === 0) return 'done'
  return failed === runs.length ? 'failed' : 'partial'
}
