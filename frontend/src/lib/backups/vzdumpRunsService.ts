/**
 * Live backup run history of one PVE connection (issue #1003).
 *
 * Reads the vzdump tasks of every online node from the node task index
 * (`source=all` so running tasks are listed), loads what each task needs through
 * the caches — the first log line always, the full log only for a task not OK,
 * still running, or backing up `--all`/`--pool` (the guest list is in the log) —
 * and hands everything to buildRunHistory. History depth is what the node task
 * index still holds (pveupdate drops logs older than index.1).
 */

import type { PveConn } from '@/lib/connections/getConnection'
import { pveFetch } from '@/lib/proxmox/client'
import { fetchTaskFirstLine, fetchTaskLog } from '@/lib/proxmox/taskLog'

import { parseVzdumpCommandLine, type VzdumpInvocation } from './vzdumpCommandLine'
import { parseVzdumpLog, type ParsedVzdumpLog } from './vzdumpLog'
import { getVzdumpRunCaches } from './vzdumpRunCache'
import { buildRunHistory, isTaskRunning, type RunSummary, type TaskFacts, type VzdumpTaskEntry } from './vzdumpRuns'

export const DEFAULT_DAYS = 30
export const MAX_DAYS = 90
export const RESULT_TTL_MS = 30_000
const TASK_LIST_LIMIT = 1000
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
  window: { since: number; days: number }
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

  let log: ParsedVzdumpLog | null = null
  if (needsFullLog(task, invocation)) {
    log = running ? null : caches.parsed.get(key) ?? null
    if (!log) {
      const lines = await fetchTaskLog(conn, task.node, task.upid).catch(() => null)
      if (lines) {
        log = parseVzdumpLog(lines, { taskStart: task.starttime, running, exitStatus: task.status ?? null })
        if (!running) caches.parsed.set(key, log)
      }
    }
  }

  return { task, invocation, log }
}

export async function collectBackupRuns(
  conn: PveConn,
  connectionId: string,
  opts: { days: number; noCache?: boolean; now?: number },
): Promise<BackupRunsResult> {
  const caches = getVzdumpRunCaches()
  const now = opts.now ?? Date.now()
  const cacheKey = `${connectionId}:${opts.days}`
  const hit = caches.results.get(cacheKey)
  if (!opts.noCache && hit && now - hit.at < RESULT_TTL_MS) return hit.value

  const since = Math.floor(now / 1000) - opts.days * 86400
  const [jobs, nodes] = await Promise.all([
    pveFetch<any[]>(conn, '/cluster/backup'),
    pveFetch<any[]>(conn, '/nodes'),
  ])

  const unreachableNodes: string[] = []
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
        for (const t of list || []) if (t?.upid) tasks.push({ ...t, node: t.node ?? node })
      } catch {
        unreachableNodes.push(node)
      }
    }),
  )

  const facts = await mapLimit(tasks, CONCURRENCY, t => loadTaskFacts(conn, connectionId, t))
  const history = buildRunHistory((jobs || []).map(j => ({ id: String(j.id), raw: j })), facts)

  const value: BackupRunsResult = {
    jobs: (jobs || []).map(j => {
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
    unreachableNodes,
    window: { since, days: opts.days },
  }
  caches.results.set(cacheKey, { at: now, value })

  return value
}

export async function loadRunTaskDetail(conn: PveConn, node: string, upid: string): Promise<RunTaskDetail> {
  const status = await pveFetch<any>(conn, `/nodes/${encodeURIComponent(node)}/tasks/${encodeURIComponent(upid)}/status`)
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
    log: parseVzdumpLog(lines, { taskStart: status?.starttime ?? null, running, exitStatus: status?.exitstatus ?? null }),
    totalLines: lines.length,
  }
}
