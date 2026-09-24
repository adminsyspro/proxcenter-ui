/**
 * Attach vzdump tasks to the backup job that started them and group them into
 * runs (issue #1003).
 *
 * A task belongs to a job when every non-selection option of the job's
 * invocation equals the task's (see vzdumpCommandLine.ts) and the selection is
 * compatible. One scheduled run is one task per node forked at the same time,
 * so tasks of a job starting within RUN_GROUP_WINDOW_SEC of the run's first task
 * form one run — unless the node already has a task in it (two quick "Run now").
 * Tasks no job accounts for (guest-level backups, CLI, deleted or edited jobs)
 * are returned as the manual row, one run each.
 */

import { jobInvocation, type VzdumpInvocation } from './vzdumpCommandLine'
import type { GuestStatus, PostStep, TaskLogSummary } from './vzdumpLog'

export const RUN_GROUP_WINDOW_SEC = 600

export interface VzdumpTaskEntry {
  upid: string
  node: string
  starttime: number
  endtime?: number
  status?: string
  user?: string
  tokenid?: string
}

export interface TaskFacts {
  task: VzdumpTaskEntry
  invocation: VzdumpInvocation | null
  /** Read only when the task list cannot tell (see needsFullLog); a ParsedVzdumpLog fits too. */
  log: TaskLogSummary | null
}

export type RunStatus = 'ok' | 'warning' | 'post_step_failed' | 'partial' | 'failed' | 'running'
export type RunOrigin = 'scheduled' | 'manual'

export interface RunTask {
  node: string
  upid: string
  status: string
  start: number
  end: number | null
  vmids: number[]
  logUnavailable: boolean
}

export interface RunSummary {
  id: string
  start: number
  end: number | null
  durationSec: number | null
  origin: RunOrigin
  status: RunStatus
  statusDetail: { step?: PostStep; failed: number; total: number; reason?: string }
  sharedWith?: string[]
  tasks: RunTask[]
}

export interface JobRef {
  id: string
  raw: Record<string, any>
}

export interface RunHistory {
  byJob: Map<string, RunSummary[]>
  manual: RunSummary[]
}

/**
 * A task PVE still runs: the task list reports it as status 'RUNNING'
 * (PVE/API2/Tasks.pm sets it when the index has no status yet); an entry with
 * neither status nor end time is running too.
 */
export function isTaskRunning(task: VzdumpTaskEntry): boolean {
  return task.status === 'RUNNING' || (!task.status && !task.endtime)
}

function sameOptions(a: Record<string, string>, b: Record<string, string>): boolean {
  const ka = Object.keys(a)
  if (ka.length !== Object.keys(b).length) return false

  return ka.every(k => b[k] === a[k])
}

function sameList(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

/** True when `task` is a run of the job whose invocation is `job`. */
export function jobMatches(job: VzdumpInvocation, task: VzdumpInvocation): boolean {
  // Every API-started run prints --node (it is the path parameter); only a
  // pinned job's scheduled run prints it too.
  if (job.node && task.node !== job.node) return false
  if (!sameOptions(job.options, task.options)) return false

  if (job.all) return task.all && sameList(job.exclude, task.exclude)
  if (task.all) return false
  // "Run now" replays a pool job as the per-node vmid list (runDispatch.ts).
  if (job.pool) return task.pool === job.pool || (task.pool === null && task.vmids.length > 0)
  if (job.vmids.length > 0) {
    return task.pool === null && task.vmids.length > 0 && task.vmids.every(v => job.vmids.includes(v))
  }

  return false
}

function taskOrigin(f: TaskFacts): RunOrigin {
  return f.invocation?.quiet && !f.task.tokenid ? 'scheduled' : 'manual'
}

/** The guests a task backed up: from its log when read, else its command line. */
export function taskVmids(f: TaskFacts): number[] {
  if (f.log && f.log.guests.length > 0) return f.log.guests.map(g => g.vmid)

  return f.invocation?.vmids ?? []
}

interface Unit {
  status: GuestStatus
  step?: PostStep | null
  reason?: string | null
}

function taskUnits(f: TaskFacts): Unit[] {
  if (isTaskRunning(f.task)) return (f.log?.guests ?? []).map(g => ({ status: g.status }))
  if (f.log && f.log.guests.length > 0) return f.log.guests.map(g => ({ status: g.status, step: g.step, reason: g.reason }))

  const status = f.task.status ?? ''
  const count = Math.max(taskVmids(f).length, 1)
  if (status === 'OK') return Array.from({ length: count }, () => ({ status: 'ok' as const }))
  if (status.startsWith('WARNINGS')) return Array.from({ length: count }, () => ({ status: 'ok_warnings' as const }))

  return [{ status: 'failed', reason: f.log?.taskError ?? status }]
}

function aggregate(group: TaskFacts[]): Pick<RunSummary, 'status' | 'statusDetail'> {
  const units = group.flatMap(taskUnits)
  const total = units.length
  const failed = units.filter(u => u.status === 'failed')
  const post = units.filter(u => u.status === 'post_step_failed')

  if (group.some(f => isTaskRunning(f.task))) return { status: 'running', statusDetail: { failed: failed.length, total } }
  if (failed.length > 0) {
    return {
      status: failed.length === total ? 'failed' : 'partial',
      statusDetail: { failed: failed.length, total, reason: failed[0].reason ?? undefined },
    }
  }
  if (post.length > 0) {
    const steps = new Set(post.map(u => u.step ?? 'other'))
    return {
      status: 'post_step_failed',
      statusDetail: {
        failed: post.length,
        total,
        step: steps.size === 1 ? [...steps][0] : 'other',
        reason: post[0].reason ?? undefined,
      },
    }
  }
  if (units.some(u => u.status === 'ok_warnings')) return { status: 'warning', statusDetail: { failed: 0, total } }

  return { status: 'ok', statusDetail: { failed: 0, total } }
}

function toRun(group: TaskFacts[], shared: Map<string, string[]>): RunSummary {
  const tasks: RunTask[] = group.map(f => ({
    node: f.task.node,
    upid: f.task.upid,
    status: isTaskRunning(f.task) ? 'running' : f.task.status ?? '',
    start: f.task.starttime,
    end: f.task.endtime ?? null,
    vmids: taskVmids(f),
    logUnavailable: f.invocation === null,
  }))
  const start = Math.min(...tasks.map(t => t.start))
  const end = tasks.every(t => t.end !== null) ? Math.max(...tasks.map(t => t.end as number)) : null
  const sharedWith = [...new Set(group.flatMap(f => shared.get(f.task.upid) ?? []))]

  return {
    id: tasks[0].upid,
    start,
    end,
    durationSec: end === null ? null : end - start,
    origin: group.every(f => taskOrigin(f) === 'scheduled') ? 'scheduled' : 'manual',
    ...aggregate(group),
    ...(sharedWith.length > 0 ? { sharedWith } : {}),
    tasks,
  }
}

function groupByWindow(facts: TaskFacts[], windowSec: number): TaskFacts[][] {
  const sorted = [...facts].sort((a, b) => a.task.starttime - b.task.starttime)
  const groups: TaskFacts[][] = []

  for (const f of sorted) {
    const g = groups.at(-1)
    const fits =
      g !== undefined &&
      f.task.starttime - g[0].task.starttime < windowSec &&
      !g.some(x => x.task.node === f.task.node)
    if (fits) g.push(f)
    else groups.push([f])
  }

  return groups
}

const newestFirst = (a: RunSummary, b: RunSummary) => b.start - a.start

/**
 * Attach every task to its job (or the manual row) and group them into runs.
 * `keepTask` drops tasks before anything is matched or grouped, so a run's
 * id, times, status and reason are computed over the kept tasks only (tenant
 * scoping, vzdumpRunsTenant.ts).
 */
export function buildRunHistory(
  jobs: JobRef[],
  allFacts: TaskFacts[],
  windowSec = RUN_GROUP_WINDOW_SEC,
  keepTask?: (facts: TaskFacts) => boolean,
): RunHistory {
  const facts = keepTask ? allFacts.filter(keepTask) : allFacts
  const candidates = jobs
    .map(j => ({ id: j.id, inv: jobInvocation(j.raw) }))
    .sort((a, b) => a.id.localeCompare(b.id))
  const perJob = new Map<string, TaskFacts[]>(jobs.map(j => [j.id, []]))
  const shared = new Map<string, string[]>()
  const manual: TaskFacts[] = []

  for (const f of facts) {
    const matches = f.invocation ? candidates.filter(c => jobMatches(c.inv, f.invocation!)) : []
    if (matches.length === 0) {
      manual.push(f)
      continue
    }
    perJob.get(matches[0].id)!.push(f)
    if (matches.length > 1) shared.set(f.task.upid, matches.slice(1).map(m => m.id))
  }

  const byJob = new Map<string, RunSummary[]>()
  for (const [id, list] of perJob) {
    byJob.set(id, groupByWindow(list, windowSec).map(g => toRun(g, shared)).sort(newestFirst))
  }

  return { byJob, manual: manual.map(f => toRun([f], shared)).sort(newestFirst) }
}
