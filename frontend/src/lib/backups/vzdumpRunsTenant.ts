/**
 * Tenant scoping of the backup run history (issue #1003), same contract as the
 * jobs list (lib/vdc/backupJobs.ts): an iaas (vDC) tenant sees the runs of the
 * jobs on its own pools, and manual runs only when every guest they backed up
 * is in one of its pools. Provider and MSP tenants get the unfiltered result
 * (callers skip this when getAllowedJobPools returns null).
 */

import type { PveConn } from '@/lib/connections/getConnection'
import { pveFetch } from '@/lib/proxmox/client'
import { isJobOwnedByTenantPools } from '@/lib/vdc/backupJobs'

import type { BackupRunsResult } from './vzdumpRunsService'
import type { RunSummary } from './vzdumpRuns'

export function filterBackupRunsForTenant(
  result: BackupRunsResult,
  allowedPools: Set<string>,
  poolByVmid: Map<number, string>,
): BackupRunsResult {
  const owns = (vmid: number) => {
    const pool = poolByVmid.get(vmid)
    return pool !== undefined && allowedPools.has(pool)
  }

  // jobMatches (vzdumpRuns.ts) attaches a task to a job by comparing vzdump
  // *options*, not by checking who the guests belong to: a foreign vmid-list
  // task (another tenant, the provider, a "Run now" replay of a pool job)
  // can land in a run of a job this tenant owns. So scope every run — job or
  // manual — per task, the same way: drop a task unless it has at least one
  // vmid and every vmid is the tenant's, then drop the run if nothing is
  // left. sharedWith is stripped too: it can name another tenant's job id.
  // Nothing else in a surviving RunSummary is recomputed (status/duration
  // still reflect the pre-scoping task set).
  const scopeRun = (run: RunSummary): RunSummary | null => {
    const tasks = run.tasks.filter(t => t.vmids.length > 0 && t.vmids.every(owns))
    if (tasks.length === 0) return null

    const { sharedWith: _sharedWith, ...rest } = run

    return { ...rest, tasks }
  }
  const scopeRuns = (runs: RunSummary[]): RunSummary[] =>
    runs.map(scopeRun).filter((r): r is RunSummary => r !== null)

  const manualRuns = scopeRuns(result.manual.runs)
  const jobs = result.jobs
    .filter(j => isJobOwnedByTenantPools(j, allowedPools))
    .map(j => {
      const runs = scopeRuns(j.runs)

      return { ...j, runs, lastRun: runs[0] ?? null }
    })

  return {
    ...result,
    jobs,
    manual: { lastRun: manualRuns[0] ?? null, runs: manualRuns },
    unreachableNodes: [],
  }
}

export function isTaskVisible(result: BackupRunsResult, node: string, upid: string): boolean {
  const all: RunSummary[] = [...result.jobs.flatMap(j => j.runs), ...result.manual.runs]

  return all.some(r => r.tasks.some(t => t.node === node && t.upid === upid))
}

/** Pool of every guest, from /cluster/resources (a guest outside any pool is absent). */
export async function loadPoolByVmid(conn: PveConn): Promise<Map<number, string>> {
  const resources = (await pveFetch<any[]>(conn, '/cluster/resources?type=vm')) || []
  const map = new Map<number, string>()
  for (const r of resources) if (r?.pool && Number.isFinite(Number(r.vmid))) map.set(Number(r.vmid), String(r.pool))

  return map
}
