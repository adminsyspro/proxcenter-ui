import type { PCTask } from '@/contexts/ProxCenterTasksContext'

import { mergeSharedTasks, sortPcTasks, type MergedPCTask } from './mergeSharedTasks'
import type { SharedTask } from './sharedTask'
import { jobTypeIcon } from './jobTypes'

/**
 * Turn Task Center jobs (rolling updates, DRS, replication, Site Recovery and
 * external migrations) into rows for the ProxCenter tab of the taskbar, which
 * used to list nothing but the migrations of the last 30 minutes.
 *
 * The whole list is kept, terminal rows included: the taskbar mirrors what the
 * Task Center shows, and the jobs endpoint already caps itself (50 rows). Only
 * duplication is filtered, in mergeTaskbarRows below.
 */

/** Job status -> the three states a taskbar row can render. */
function taskbarStatus(status?: string): MergedPCTask['status'] {
  if (status === 'success' || status === 'completed') return 'done'
  if (status === 'failed' || status === 'cancelled') return 'error'

  return 'running'
}

function timeOf(value: unknown): number | null {
  if (!value) return null
  const ms = Date.parse(String(value))

  return Number.isNaN(ms) ? null : ms
}

/**
 * Row id. Migrations share the `migration-<jobId>` namespace with the rows
 * built from /api/v1/tasks/shared so the same migration cannot appear twice:
 * mergeTaskbarRows keeps the shared row, which carries the initiator's live
 * progress, the "started by" line and the detail dialog.
 */
export function taskbarRowId(job: any): string {
  return job?.type === 'migration' ? `migration-${job.id}` : `job-${job.id}`
}

export function orchestratorTaskRows(jobs: any[]): MergedPCTask[] {
  if (!Array.isArray(jobs)) return []

  return jobs
    .filter(job => job?.id)
    .map(job => ({
      id: taskbarRowId(job),
      type: 'generic' as const,
      icon: jobTypeIcon(job.type),
      label: job.name || job.id,
      detail: job.detail || undefined,
      progress: typeof job.progress === 'number' ? job.progress : 0,
      status: taskbarStatus(job.status),
      rawStatus: job.status,
      error: job.metadata?.error || undefined,
      createdAt: timeOf(job.startedAt) ?? timeOf(job.createdAt) ?? 0,
      // Not the caller's own client-side task: no restore, no "clear completed".
      shared: true,
      readOnly: true,
      // Clicking one opens the Task Center, not the migration detail dialog:
      // that dialog only knows migrations, and only recent ones.
      orchestrator: true,
      jobId: job.id,
    }))
}

/**
 * Every row of the ProxCenter tab: the caller's own local tasks, the shared
 * migrations, then the Task Center jobs that are not already one of those.
 */
export function mergeTaskbarRows(
  localTasks: PCTask[],
  sharedTasks: SharedTask[],
  jobs: any[],
): MergedPCTask[] {
  const rows = mergeSharedTasks(localTasks, sharedTasks)
  const seen = new Set(rows.map(r => r.id))

  for (const row of orchestratorTaskRows(jobs)) {
    if (seen.has(row.id)) continue
    seen.add(row.id)
    rows.push(row)
  }

  return sortPcTasks(rows)
}
