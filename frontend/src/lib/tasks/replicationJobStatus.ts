/**
 * Maps a Site Recovery replication job status to the unified job status of
 * the Task Center feed, which only renders success / running / failed plus the
 * pass-through values (paused, pending, no_match, failed_over).
 *
 * "partial" (some VMs synced, at least one in error, the job stays scheduled)
 * surfaces as failed: the taskbar rows know nothing else than success, failed
 * and running, and anything else would spin forever as a running task.
 */
export function replicationJobStatus(status: string): string {
  if (status === 'synced') return 'success'
  if (status === 'syncing') return 'running'
  if (status === 'error' || status === 'partial') return 'failed'

  return status
}
