/** Presentation mapping of the backup run history (issue #1003), kept out of JSX so it is tested. */

import type { GuestStatus, PostStep } from './vzdumpLog'
import type { RunSummary, RunTask } from './vzdumpRuns'
import type { BackupRunsResult } from './vzdumpRunsService'

export type ChipColor = 'success' | 'warning' | 'error' | 'info'

export interface StatusChip {
  color: ChipColor
  key: string
  /** "failed/total" to append to the label, or null. */
  count: string | null
}

export function runStatusChip(run: Pick<RunSummary, 'status' | 'statusDetail'>): StatusChip {
  const { failed, total, step } = run.statusDetail
  const count = total > 1 ? `${failed}/${total}` : null

  switch (run.status) {
    case 'ok':
      return { color: 'success', key: 'backups.runs.status.ok', count: null }
    case 'warning':
      return { color: 'warning', key: 'backups.runs.status.warning', count: null }
    case 'running':
      return { color: 'info', key: 'backups.runs.status.running', count: null }
    case 'post_step_failed':
      return { color: 'warning', key: `backups.runs.status.post.${step ?? 'other'}`, count }
    case 'partial':
      return { color: 'error', key: 'backups.runs.status.partial', count }
    default:
      return { color: 'error', key: 'backups.runs.status.failed', count: null }
  }
}

export function guestStatusChip(g: { status: GuestStatus; step: PostStep | null }): StatusChip {
  switch (g.status) {
    case 'ok':
      return { color: 'success', key: 'backups.runs.status.ok', count: null }
    case 'ok_warnings':
      return { color: 'warning', key: 'backups.runs.status.warning', count: null }
    case 'running':
      return { color: 'info', key: 'backups.runs.status.running', count: null }
    case 'post_step_failed':
      return { color: 'warning', key: `backups.runs.status.post.${g.step ?? 'other'}`, count: null }
    default:
      return { color: 'error', key: 'backups.runs.status.failed', count: null }
  }
}

const pad = (n: number) => String(n).padStart(2, '0')

export function formatDurationSec(sec: number | null | undefined): string {
  if (sec === null || sec === undefined || !Number.isFinite(sec) || sec < 0) return '—'
  const s = Math.round(sec)
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.floor(s / 60)}m ${pad(s % 60)}s`

  return `${Math.floor(s / 3600)}h ${pad(Math.floor((s % 3600) / 60))}m`
}

export function logLineKind(text: string): 'error' | 'warning' | 'info' {
  if (/^(TASK )?ERROR:/.test(text)) return 'error'
  if (/^(WARN(ING)?:|TASK WARNINGS:)/.test(text)) return 'warning'

  return 'info'
}

export function isProgressLine(text: string): boolean {
  return /^INFO:\s+\d+% \(/.test(text)
}

export const RUNS_POLL_FAST_MS = 5000
export const RUNS_POLL_SLOW_MS = 30_000

type RunsLists = Pick<BackupRunsResult, 'jobs' | 'manual'>
type RunLike = Pick<RunSummary, 'id' | 'status'> & { tasks: Array<Pick<RunTask, 'upid'>> }

/**
 * How often the jobs tab reloads the run history: fast while a run is going
 * or a Run now's task has not shown up yet, slow otherwise. Read by SWR from
 * the latest data (`refreshInterval` as a function), so the key never changes.
 */
export function runsPollIntervalMs(data: RunsLists | undefined, awaitedUpid: string | null): number {
  if (!data) return RUNS_POLL_SLOW_MS
  const runs: RunLike[] = [...data.jobs.flatMap(j => j.runs), ...data.manual.runs]
  if (runs.some(run => run.status === 'running')) return RUNS_POLL_FAST_MS
  if (awaitedUpid && !runs.some(run => run.tasks.some(t => t.upid === awaitedUpid))) return RUNS_POLL_FAST_MS

  return RUNS_POLL_SLOW_MS
}

/** The run the drawer shows: the user's pick while listed, else the focused task's run, else the newest. */
export function selectRunId(runs: RunLike[], userChoice: string | null, focusUpid: string | null): string | null {
  if (userChoice && runs.some(run => run.id === userChoice)) return userChoice
  const focused = focusUpid ? runs.find(run => run.tasks.some(t => t.upid === focusUpid)) : undefined

  return focused?.id ?? runs[0]?.id ?? null
}

/**
 * The detail route of one task. `days` lets the route check a tenant's
 * visibility in the drawer's own window; `state` is in the key so the log is
 * fetched once more when a running task ends.
 */
export function runTaskDetailUrl(connectionId: string, task: Pick<RunTask, 'node' | 'upid' | 'status'>, days: number): string {
  const path = `/api/v1/connections/${encodeURIComponent(connectionId)}/backup-jobs/runs/${encodeURIComponent(task.node)}/${encodeURIComponent(task.upid)}`

  return `${path}?days=${days}&state=${task.status === 'running' ? 'running' : 'done'}`
}
