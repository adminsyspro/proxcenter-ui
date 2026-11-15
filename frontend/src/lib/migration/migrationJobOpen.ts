// Reopening the migrate dialog of a run from anywhere: the task bar at the
// bottom and the running-tasks menu at the top. Same shape as bulkBatchOpen.
//
// The dialog lives in the Inventory page. In order: the tab that started the
// run still holds its dialog (restore callback); else a mounted Inventory page
// claims the request through a DOM event and rebuilds the dialog from the run's
// record; else the caller navigates to the source host with the run in the URL
// and the Inventory page opens it once loaded. A run of a bulk migration opens
// the follow-up of its batch, the dialog it was started from.

import { bulkBatchInventoryUrl, requestOpenBulkBatch } from './bulkBatchOpen'

export const OPEN_MIGRATION_JOB_EVENT = 'proxcenter:open-migration-job'

export interface OpenMigrationJobDetail {
  jobId: string
  /** Set by the listener that takes the request. */
  handled: boolean
}

/** Ask a mounted Inventory page to reopen the run. True when one took it. */
export function requestOpenMigrationJob(jobId: string): boolean {
  const detail: OpenMigrationJobDetail = { jobId, handled: false }
  window.dispatchEvent(new CustomEvent<OpenMigrationJobDetail>(OPEN_MIGRATION_JOB_EVENT, { detail }))
  return detail.handled
}

/**
 * The Inventory page reopening the run, on its source host when it is known (a
 * row of this tab only knows its run; the dialog does not need the host).
 */
export function migrationJobInventoryUrl(jobId: string, sourceConnectionId?: string | null): string {
  const q = new URLSearchParams(sourceConnectionId ? { selectType: 'ext', selectId: sourceConnectionId, openMigration: jobId } : { openMigration: jobId })
  return `/infrastructure/inventory?${q.toString()}`
}

/** What the migrate dialog needs of its source VM to show a run, from the run's record. */
export interface MigrationDialogVm {
  vmid: string
  name: string
  connId: string
  connName: string
  hostType: string
  restoreJobId: string
}

export function migrationDialogVm(job: {
  id: string
  sourceConnectionId: string
  sourceVmId: string
  sourceVmName?: string | null
  config?: { sourceType?: string | null } | null
}): MigrationDialogVm {
  const sourceType = job.config?.sourceType ?? 'vmware'
  // The pipelines store a direct ESXi source as esxi or vmware; the inventory
  // knows that host as vmware, a vCenter as vcenter, the others by their name.
  const hostType = ['esxi', 'esxi-direct', 'vmware'].includes(sourceType) ? 'vmware' : sourceType
  return { vmid: job.sourceVmId, name: job.sourceVmName || job.sourceVmId, connId: job.sourceConnectionId, connName: '', hostType, restoreJobId: job.id }
}

/** Open the dialog a run was started from, wherever the operator is. */
export function openMigration(
  job: { id: string; sourceConnectionId?: string | null; batchId?: string | null },
  how: { restore: (taskId: string) => boolean; navigate: (url: string) => void },
): void {
  if (job.batchId && job.sourceConnectionId) {
    if (!requestOpenBulkBatch(job.batchId, job.sourceConnectionId)) how.navigate(bulkBatchInventoryUrl(job.batchId, job.sourceConnectionId))
    return
  }
  if (how.restore(`migration-${job.id}`)) return
  if (!requestOpenMigrationJob(job.id)) how.navigate(migrationJobInventoryUrl(job.id, job.sourceConnectionId))
}

/**
 * A Task Center job that is a migration, as the run openMigration reopens; null
 * for any other job, which keeps its own dialog. The feed carries the source
 * host and the batch in the job's metadata.
 */
export function migrationFromTaskCenterJob(job: { id?: string; type?: string; metadata?: Record<string, any> | null } | null | undefined): { id: string; sourceConnectionId: string | null; batchId: string | null } | null {
  if (!job?.id || job.type !== 'migration') return null
  return { id: job.id, sourceConnectionId: job.metadata?.sourceConnectionId ?? null, batchId: job.metadata?.batchId ?? null }
}
