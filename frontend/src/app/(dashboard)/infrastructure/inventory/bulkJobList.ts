// The job list of a bulk migration as the dialog shows it (roadmap#53): one
// count per state and the rows that need attention first, so a batch of
// dozens of VMs stays readable page by page.

import { mergeJobLogs } from '@/lib/migration/jobLogs'
import { parseCutoverMeasure, type CutoverMeasure } from '@/lib/migration/warm/sync-interval'
import { isTestActive } from '@/lib/migration/warm/migration-test-state'

const measureOf = (job: { syncMeasure?: unknown }) => parseCutoverMeasure(job.syncMeasure)

export interface BulkJobLike {
  vmid: string
  status: string
}

// Cancelled is a state of its own, not a failure: "Cancel queued" cancels
// every job of a batch that has not started, and those never ran.
export type BulkJobState = 'failed' | 'active' | 'queued' | 'completed' | 'cancelled'

export function bulkJobState(status: string): BulkJobState {
  if (status === 'completed') return 'completed'
  if (status === 'failed') return 'failed'
  if (status === 'cancelled') return 'cancelled'
  if (status === 'queued') return 'queued'
  return 'active'
}

export function countBulkJobs(jobs: BulkJobLike[]): Record<BulkJobState, number> {
  const counts: Record<BulkJobState, number> = { failed: 0, active: 0, queued: 0, completed: 0, cancelled: 0 }
  for (const job of jobs) counts[bulkJobState(job.status)]++
  return counts
}

/** How a migration job's status chip reads: done, failed, greyed out (queued or cancelled) or running with its %. */
export type MigrationChipTone = 'success' | 'error' | 'muted' | 'active'

export function migrationChipTone(status: string): MigrationChipTone {
  switch (bulkJobState(status)) {
    case 'completed': return 'success'
    case 'failed': return 'error'
    case 'queued':
    case 'cancelled': return 'muted'
    default: return 'active'
  }
}

/** i18n key under inventoryPage.esxiMigration of a status chip; null for a running job, which shows its %. */
export function migrationChipLabelKey(status: string): string | null {
  const state = bulkJobState(status)
  return state === 'active' ? null : state
}

export const MIGRATION_CHIP_COLORS: Record<MigrationChipTone, { bg: string; fg: string }> = {
  success: { bg: 'success.main', fg: 'success.contrastText' },
  error: { bg: 'error.main', fg: 'error.contrastText' },
  muted: { bg: 'action.disabled', fg: 'common.white' },
  active: { bg: 'primary.main', fg: 'primary.contrastText' },
}

const ORDER: Record<BulkJobState, number> = { failed: 0, active: 1, queued: 2, completed: 3, cancelled: 4 }

/** Failed, then running, queued, completed and cancelled; the batch order is kept within each. */
export function orderBulkJobs<T extends BulkJobLike>(jobs: T[]): T[] {
  return jobs
    .map((job, i) => ({ job, i }))
    .sort((a, b) => ORDER[bulkJobState(a.job.status)] - ORDER[bulkJobState(b.job.status)] || a.i - b.i)
    .map(({ job }) => job)
}

// ------------------------------------------------------------------ //
// Server-side batch (roadmap#53 part B)
// ------------------------------------------------------------------ //
// The queue of a bulk migration lives on the server: every VM is a job created
// up front as "queued" and the server starts them `concurrency` at a time, so
// closing the tab no longer strands the rest of the batch. The browser only
// follows the batch and steers it (pause, resume, cancel the queued jobs).

export const TERMINAL_JOB_STATUSES = ['completed', 'failed', 'cancelled']

export function isTerminalJobStatus(status: string): boolean {
  return TERMINAL_JOB_STATUSES.includes(status)
}

/** The batch the bulk dialog follows. */
export interface BulkMigBatch {
  id: string
  status: string
  concurrency: number
  sourceConnectionId?: string
  /** The PVE connection of the target nodes, for their live load in the follow-up. */
  targetConnectionId?: string
}

/** One row of the bulk dialog, one per VM of the batch. */
export interface BulkMigJobRow {
  vmid: string
  name: string
  jobId: string
  status: string
  progress: number
  error?: string
  logs?: { ts: string; msg: string; level: string }[]
  targetNode?: string
  /** Cumulated bytes copied so far, the follow-up derives the throughput from it. */
  bytesTransferred?: number
  /** The engine's live copy rate ("33 MB/s"), preferred to the counter for the throughput. */
  transferSpeed?: string | null
  /** Downtime the last delta pass of a warm job projects for a cutover now, in seconds. */
  projectedDowntimeSec?: number | null
  /** True for a warm job launched with a manual cutover: in delta_sync it waits for the operator. */
  manualHold?: boolean
  /** Interval a manual job syncs at while it waits, in seconds. */
  syncIntervalSec?: number
  /** Interval the engine suggests from the syncs it measured, in seconds. */
  suggestedSyncIntervalSec?: number
  /** What those syncs measured, the cutover is estimated from it. */
  syncMeasure?: CutoverMeasure
  /** A test VM runs on the copy of this waiting job (migration-test.ts). */
  inTest?: boolean
}

/** A job as GET /api/v1/migrations/batches/[id] returns it (the fields read here). */
export interface BatchJobPayload {
  id: string
  sourceVmId: string
  sourceVmName?: string | null
  targetNode?: string | null
  status: string
  progress?: number | null
  error?: string | null
  /** From line `logOffset` on, when the read named the lines already shown (logsAfter). */
  logs?: { ts: string; msg: string; level: string }[] | null
  logOffset?: number
  currentStep?: string | null
  transferSpeed?: string | null
  bytesTransferred?: number | null
  startedAt?: string | null
  projectedDowntimeSec?: number | null
  /** "manual" for a warm job launched with a manual cutover, "auto" otherwise. */
  cutoverMode?: string | null
  syncIntervalSec?: number | null
  suggestedSyncIntervalSec?: number | null
  syncMeasure?: unknown
  testRequest?: unknown
  testState?: unknown
}

export interface BatchPayload {
  id: string
  status: string
  concurrency: number
  sourceConnectionId: string
  targetConnectionId: string
  jobs: BatchJobPayload[]
}

/**
 * The dialog rows of a batch read. `previous` (the rows shown so far) carries
 * the log lines a read that only sent the new ones extends (mergeJobLogs).
 */
export function bulkRowsFromBatch(jobs: BatchJobPayload[], previous: BulkMigJobRow[] = []): BulkMigJobRow[] {
  const shown = new Map(previous.map(r => [r.jobId, r]))

  return jobs.map(j => {
    const prev = shown.get(j.id)
    const logs = mergeJobLogs(prev && { id: prev.jobId, logs: prev.logs }, j)

    return {
      vmid: j.sourceVmId,
      name: j.sourceVmName || j.sourceVmId,
      jobId: j.id,
      status: j.status,
      progress: j.progress || 0,
      ...(j.error ? { error: j.error } : {}),
      ...(logs.length ? { logs } : {}),
      ...(j.targetNode ? { targetNode: j.targetNode } : {}),
      ...(j.projectedDowntimeSec != null ? { projectedDowntimeSec: j.projectedDowntimeSec } : {}),
      ...(j.cutoverMode === 'manual' ? { manualHold: true } : {}),
      ...(j.cutoverMode === 'manual' && j.syncIntervalSec != null ? { syncIntervalSec: j.syncIntervalSec } : {}),
      ...(j.cutoverMode === 'manual' && j.suggestedSyncIntervalSec != null ? { suggestedSyncIntervalSec: j.suggestedSyncIntervalSec } : {}),
      ...(j.cutoverMode === 'manual' && measureOf(j) ? { syncMeasure: measureOf(j)! } : {}),
      ...(j.bytesTransferred != null && Number.isFinite(Number(j.bytesTransferred)) ? { bytesTransferred: Number(j.bytesTransferred) } : {}),
      ...(j.transferSpeed ? { transferSpeed: j.transferSpeed } : {}),
      ...(!isTerminalJobStatus(j.status) && isTestActive(j) ? { inTest: true } : {}),
    }
  })
}

/** Colours and label of a bulk job row: done, failed, cancelled, queued (or paused), under test or running. */
export function bulkJobRowTone(s: { isDone: boolean; isFailed: boolean; isCancelled: boolean; isQueued: boolean; isPaused: boolean; inTest?: boolean }): { line: string; chipBg: string; chipColor: string; labelKey?: string } {
  if (s.isDone) return { line: 'success.main', chipBg: 'success.main', chipColor: 'success.contrastText', labelKey: 'completed' }
  if (s.isFailed) return { line: 'error.main', chipBg: 'error.main', chipColor: 'error.contrastText', labelKey: 'failed' }
  if (s.isCancelled) return { line: 'divider', chipBg: 'action.disabled', chipColor: 'common.white', labelKey: 'cancelled' }
  if (s.isQueued) return { line: 'divider', chipBg: 'action.disabled', chipColor: 'common.white', labelKey: s.isPaused ? 'paused' : 'queued' }
  if (s.inTest) return { line: 'divider', chipBg: 'info.main', chipColor: 'info.contrastText', labelKey: 'testRowLabel' }
  return { line: 'divider', chipBg: 'primary.main', chipColor: 'primary.contrastText' }
}

/** The log lines each row already shows, in batch order: the `logsAfter` of the next read. */
export function bulkLogOffsets(rows: BulkMigJobRow[]): number[] {
  return rows.map(r => r.logs?.length ?? 0)
}

/** The batch fields the dialog keeps, from a read of the batch. */
export function bulkBatchFromPayload(snap: BatchPayload): BulkMigBatch {
  return { id: snap.id, status: snap.status, concurrency: snap.concurrency, sourceConnectionId: snap.sourceConnectionId, targetConnectionId: snap.targetConnectionId }
}

/**
 * Nothing left to follow: the batch will start nothing more (completed or
 * cancelled) and no job still holds a slot. A paused batch is never finished,
 * it can be resumed from another tab.
 */
export function isBulkBatchFinished(status: string, jobs: { status: string }[]): boolean {
  return (status === 'completed' || status === 'cancelled') && jobs.every(j => isTerminalJobStatus(j.status))
}

/**
 * Whether a job gets its task-bar entry now, given the status it had at the
 * previous look (undefined when never seen). A started job does; a job already
 * over when the batch is first loaded (a follow-up reopened later) does not,
 * nor a queued job the operator cancelled before it ever started.
 */
export function shouldTrackBulkJob(job: { status: string; startedAt?: string | null }, previousStatus: string | undefined): boolean {
  if (job.status === 'queued') return false
  if (!isTerminalJobStatus(job.status)) return true
  if (previousStatus === undefined || isTerminalJobStatus(previousStatus)) return false
  // Seen queued or running a moment ago: report it, unless it never started.
  return previousStatus !== 'queued' || !!job.startedAt
}

/** Source label of the task-bar entries, from the host type of the bulk dialog. */
export function bulkSourceTypeLabel(hostType: string | undefined | null): string {
  switch (hostType) {
    case 'xcpng': return 'XCP-ng'
    case 'vcenter': return 'vCenter'
    case 'hyperv': return 'Hyper-V'
    case 'nutanix': return 'Nutanix'
    default: return 'ESXi'
  }
}

/**
 * One batch with its jobs, or null when it cannot be read right now.
 * `logsAfter` (bulkLogOffsets of the rows shown) asks only for new log lines.
 */
export async function fetchBulkBatch(id: string, logsAfter?: number[]): Promise<BatchPayload | null> {
  try {
    const query = logsAfter?.length ? `?logsAfter=${logsAfter.join(',')}` : ''
    const res = await fetch(`/api/v1/migrations/batches/${encodeURIComponent(id)}${query}`)
    if (!res.ok) return null
    const d = await res.json()
    return d?.data?.id ? d.data as BatchPayload : null
  } catch {
    return null
  }
}

/** The newest batch still in flight from a source connection, with its jobs. */
export async function fetchActiveBulkBatch(sourceConnectionId: string): Promise<BatchPayload | null> {
  try {
    const res = await fetch(`/api/v1/migrations/batches?active=1&sourceConnectionId=${encodeURIComponent(sourceConnectionId)}`)
    if (!res.ok) return null
    const d = await res.json()
    const newest = Array.isArray(d?.data) ? d.data[0] : null
    return newest?.id ? fetchBulkBatch(newest.id) : null
  } catch {
    return null
  }
}

/**
 * The jobs of a batch a group cutover can act on: the ones held for a manual
 * cutover once a first sync gave a downtime projection (before that the engine
 * has nothing to resume from), and the automatic ones parked at the operator
 * gate because their projection exceeds the budget.
 */
export function bulkJobsAwaitingCutover(rows: BulkMigJobRow[]): BulkMigJobRow[] {
  return rows.filter(r => r.status === 'awaiting_cutover' || (r.status === 'delta_sync' && r.manualHold === true && r.projectedDowntimeSec != null))
}

/**
 * The jobs of a batch whose sync interval can still be changed: launched with
 * a manual cutover and not over, queued ones included (the value then applies
 * from their first wait). A job whose cutover is already running is refused by
 * the server and named in its answer.
 */
export function bulkJobsWithSyncInterval(rows: BulkMigJobRow[]): BulkMigJobRow[] {
  return rows.filter(r => r.manualHold === true && !isTerminalJobStatus(r.status) && r.status !== 'cutover')
}
