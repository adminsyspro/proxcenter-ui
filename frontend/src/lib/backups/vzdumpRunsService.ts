/**
 * Live backup run history of one PVE connection (issue #1003).
 *
 * Reads the vzdump tasks of every online node from the node task index
 * (`source=all` so running tasks are listed), loads what each task needs through
 * the caches — the first log line always, the full log only for a task not OK,
 * still running, or backing up `--all`/`--pool` (the guest list is in the log),
 * kept as a compact summary — and caches that raw material per connection+days
 * (RUNNING_TTL_MS while a task runs, else RESULT_TTL_MS). The result is built
 * from it per call (buildBackupRunsResult), so a tenant's view is computed over
 * its own tasks only (vzdumpRunsTenant.ts). History depth is what the node task
 * index still holds.
 */

import type { PveConn } from '@/lib/connections/getConnection'
import { pveFetch } from '@/lib/proxmox/client'
import { fetchTaskFirstLine, fetchTaskLog } from '@/lib/proxmox/taskLog'

import { parseVzdumpCommandLine, type VzdumpInvocation } from './vzdumpCommandLine'
import { parseVzdumpLog, summarizeVzdumpLog, zoneOffsetAt, type ParsedVzdumpLog, type TaskLogSummary } from './vzdumpLog'
import { getVzdumpRunCaches } from './vzdumpRunCache'
import { buildRunHistory, isTaskRunning, type RunSummary, type TaskFacts, type VzdumpTaskEntry } from './vzdumpRuns'

export const DEFAULT_DAYS = 30
export const MAX_DAYS = 90
export const RESULT_TTL_MS = 30_000
export const RUNNING_TTL_MS = 5_000
export const TASK_LIST_LIMIT = 1000
const CONCURRENCY = 8

export interface BackupRunsJob {
  jobId: string
  pool: string | null
  nextRun: number | null
  lastRun: RunSummary | null
  runs: RunSummary[]
}

export interface BackupRunsResult {
  jobs: BackupRunsJob[]
  manual: { lastRun: RunSummary | null; runs: RunSummary[] }
  unreachableNodes: string[]
  /** Nodes whose task list hit TASK_LIST_LIMIT: older runs of the window are missing. */
  truncatedNodes: string[]
  window: { since: number; days: number }
}

/** What a history is built from, cached per connection+days. */
export interface BackupRunsRaw {
  jobs: Record<string, any>[]
  facts: TaskFacts[]
  unreachableNodes: string[]
  truncatedNodes: string[]
  since: number
  days: number
}

export interface RunTaskDetail {
  task: { node: string; upid: string; status: string; start: number | null; end: number | null; user: string | null }
  log: ParsedVzdumpLog
  totalLines: number
}

export function clampDays(value: unknown): number {
  const n = Number.parseInt(String(value ?? ''), 10)
  if (!Number.isFinite(n)) return DEFAULT_DAYS

  return Math.min(MAX_DAYS, Math.max(1, n))
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker))

  return out
}

/** True when the task list alone cannot tell the status or the guests of a task. */
export function needsFullLog(task: VzdumpTaskEntry, invocation: VzdumpInvocation | null): boolean {
  if (!invocation) return false
  if (isTaskRunning(task)) return true
  const status = task.status ?? ''
  if (status !== 'OK' && !status.startsWith('WARNINGS')) return true

  return invocation.vmids.length === 0
}

async function loadTaskFacts(conn: PveConn, connectionId: string, task: VzdumpTaskEntry): Promise<TaskFacts> {
  const caches = getVzdumpRunCaches()
  const key = `${connectionId}:${task.upid}`
  const running = isTaskRunning(task)

  let first = caches.firstLines.get(key) ?? null
  if (first === null) {
    first = await fetchTaskFirstLine(conn, task.node, task.upid).catch(() => null)
    if (first) caches.firstLines.set(key, first)
  }
  const invocation = first ? parseVzdumpCommandLine(first) : null

  let log: TaskLogSummary | null = null
  if (needsFullLog(task, invocation)) {
    log = running ? null : caches.summaries.get(key) ?? null
    if (!log) {
      const lines = await fetchTaskLog(conn, task.node, task.upid).catch(() => null)
      if (lines) {
        log = summarizeVzdumpLog(parseVzdumpLog(lines, { taskStart: task.starttime, running, exitStatus: task.status ?? null }))
        if (!running) caches.summaries.set(key, log)
      }
    }
  }

  return { task, invocation, log }
}

async function scanBackupRuns(conn: PveConn, connectionId: string, days: number, now: number): Promise<BackupRunsRaw> {
  const since = Math.floor(now / 1000) - days * 86400
  const [jobs, nodes] = await Promise.all([
    pveFetch<any[]>(conn, '/cluster/backup'),
    pveFetch<any[]>(conn, '/nodes'),
  ])

  const unreachableNodes: string[] = []
  const truncatedNodes: string[] = []
  const online: string[] = []
  for (const n of nodes || []) (n.status === 'online' ? online : unreachableNodes).push(String(n.node))

  const tasks: VzdumpTaskEntry[] = []
  await Promise.all(
    online.map(async node => {
      try {
        const list = await pveFetch<any[]>(
          conn,
          `/nodes/${encodeURIComponent(node)}/tasks?typefilter=vzdump&source=all&since=${since}&limit=${TASK_LIST_LIMIT}`,
        )
        if ((list || []).length >= TASK_LIST_LIMIT) truncatedNodes.push(node)
        for (const t of list || []) if (t?.upid) tasks.push({ ...t, node: t.node ?? node })
      } catch {
        unreachableNodes.push(node)
      }
    }),
  )

  const facts = await mapLimit(tasks, CONCURRENCY, t => loadTaskFacts(conn, connectionId, t))

  return { jobs: jobs || [], facts, unreachableNodes, truncatedNodes, since, days }
}

/**
 * The raw material of a connection's history: cached a few seconds, one scan
 * in flight per connection+days (concurrent cold calls share it). `noCache`
 * skips the cached copy, not a scan already running.
 */
export async function loadBackupRunsRaw(
  conn: PveConn,
  connectionId: string,
  opts: { days: number; noCache?: boolean; now?: number },
): Promise<BackupRunsRaw> {
  const caches = getVzdumpRunCaches()
  const now = opts.now ?? Date.now()
  const key = `${connectionId}:${opts.days}`
  const hit = caches.results.get(key)
  if (!opts.noCache && hit && now - hit.at < hit.ttlMs) return hit.value

  const pending = caches.inFlight.get(key)
  if (pending) return pending

  const generation = caches.generations.get(connectionId) ?? 0
  const scan = scanBackupRuns(conn, connectionId, opts.days, now)
    .then(value => {
      if ((caches.generations.get(connectionId) ?? 0) === generation) {
        const running = value.facts.some(f => isTaskRunning(f.task))
        caches.results.set(key, { at: now, ttlMs: running ? RUNNING_TTL_MS : RESULT_TTL_MS, value })
      }

      return value
    })
    .finally(() => {
      if (caches.inFlight.get(key) === scan) caches.inFlight.delete(key)
    })
  caches.inFlight.set(key, scan)

  return scan
}

/** Forget a connection's cached history (a run was just started). */
export function invalidateBackupRuns(connectionId: string): void {
  const caches = getVzdumpRunCaches()
  const prefix = `${connectionId}:`
  for (const key of [...caches.results.keys()]) if (key.startsWith(prefix)) caches.results.delete(key)
  for (const key of [...caches.inFlight.keys()]) if (key.startsWith(prefix)) caches.inFlight.delete(key)
  caches.generations.set(connectionId, (caches.generations.get(connectionId) ?? 0) + 1)
}

/** The history served to the client; `keepTask` scopes it before runs are formed. */
export function buildBackupRunsResult(raw: BackupRunsRaw, keepTask?: (facts: TaskFacts) => boolean): BackupRunsResult {
  const history = buildRunHistory(
    raw.jobs.map(j => ({ id: String(j.id), raw: j })),
    raw.facts,
    undefined,
    keepTask,
  )

  return {
    jobs: raw.jobs.map(j => {
      const runs = history.byJob.get(String(j.id)) ?? []
      return {
        jobId: String(j.id),
        pool: j.pool ? String(j.pool) : null,
        nextRun: typeof j['next-run'] === 'number' ? j['next-run'] : null,
        lastRun: runs[0] ?? null,
        runs,
      }
    }),
    manual: { lastRun: history.manual[0] ?? null, runs: history.manual },
    unreachableNodes: raw.unreachableNodes,
    truncatedNodes: raw.truncatedNodes,
    window: { since: raw.since, days: raw.days },
  }
}

/** The full (provider) history of a connection. */
export async function collectBackupRuns(
  conn: PveConn,
  connectionId: string,
  opts: { days: number; noCache?: boolean; now?: number },
): Promise<BackupRunsResult> {
  return buildBackupRunsResult(await loadBackupRunsRaw(conn, connectionId, opts))
}

/**
 * The node's UTC offset when the task started (local − UTC, seconds), from
 * GET /nodes/{node}/time: its time zone at that instant (DST-safe), else its
 * current localtime − time, else null (the parser then falls back to its
 * task-start heuristic).
 */
function nodeUtcOffsetAt(time: any, taskStart: number | null): number | null {
  const zoned = taskStart !== null && typeof time?.timezone === 'string' ? zoneOffsetAt(time.timezone, taskStart) : null
  if (zoned !== null) return zoned
  if (time?.localtime === undefined || time?.time === undefined) return null
  const offset = Number(time.localtime) - Number(time.time)

  return Number.isFinite(offset) ? offset : null
}

export async function loadRunTaskDetail(conn: PveConn, node: string, upid: string): Promise<RunTaskDetail> {
  const [status, time] = await Promise.all([
    pveFetch<any>(conn, `/nodes/${encodeURIComponent(node)}/tasks/${encodeURIComponent(upid)}/status`),
    pveFetch<any>(conn, `/nodes/${encodeURIComponent(node)}/time`).catch(() => null),
  ])
  const utcOffsetSec = nodeUtcOffsetAt(time, typeof status?.starttime === 'number' ? status.starttime : null)
  const running = status?.status === 'running'
  const lines = await fetchTaskLog(conn, node, upid)

  return {
    task: {
      node,
      upid,
      status: running ? 'running' : status?.exitstatus ?? '',
      start: status?.starttime ?? null,
      end: status?.endtime ?? null,
      user: status?.user ?? null,
    },
    log: parseVzdumpLog(lines, {
      taskStart: status?.starttime ?? null,
      running,
      exitStatus: status?.exitstatus ?? null,
      utcOffsetSec,
    }),
    totalLines: lines.length,
  }
}
