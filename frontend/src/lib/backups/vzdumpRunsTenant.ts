/**
 * Tenant scoping of the backup run history (issue #1003), same contract as the
 * jobs list (lib/vdc/backupJobs.ts): an iaas (vDC) tenant sees the jobs on its
 * own pools and, in their runs as in the manual row, only the tasks whose every
 * guest is in one of its pools. Provider and MSP tenants get the unfiltered
 * result (callers skip this when getAllowedJobPools returns null).
 */

import type { PveConn } from '@/lib/connections/getConnection'
import { pveFetch } from '@/lib/proxmox/client'
import { isJobOwnedByTenantPools } from '@/lib/vdc/backupJobs'

import { buildBackupRunsResult, type BackupRunsRaw, type BackupRunsResult } from './vzdumpRunsService'
import { taskVmids, type RunSummary, type TaskFacts } from './vzdumpRuns'

/**
 * A task is the tenant's when it backed up at least one guest and every guest
 * it backed up is in one of the tenant's pools.
 */
export function tenantOwnsTask(allowedPools: Set<string>, poolByVmid: Map<number, string>) {
  const owns = (vmid: number) => {
    const pool = poolByVmid.get(vmid)
    return pool !== undefined && allowedPools.has(pool)
  }

  return (facts: TaskFacts): boolean => {
    const vmids = taskVmids(facts)
    return vmids.length > 0 && vmids.every(owns)
  }
}

function withoutSharedWith(run: RunSummary): RunSummary {
  const { sharedWith: _sharedWith, ...rest } = run

  return rest
}

/**
 * The history of a connection as a vDC tenant sees it, built from the raw
 * material. jobMatches (vzdumpRuns.ts) attaches a task to a job by comparing
 * vzdump *options*, not by checking who the guests belong to, so a foreign
 * task (another tenant, the provider, a "Run now" replay of a pool job) can
 * fall in a run of a job this tenant owns. Foreign tasks are therefore dropped
 * BEFORE runs are formed: a run's id, times, status and failure reason are
 * computed over the tenant's own tasks only, and a run with none of them does
 * not exist. sharedWith is stripped (it can name another tenant's job id).
 * unreachableNodes / truncatedNodes are cluster-health information that is
 * the provider's business, not the tenant's; they are emptied for that reason
 * (node names still appear in tasks[].node, the detail route needs them).
 */
export function filterBackupRunsForTenant(
  raw: BackupRunsRaw,
  allowedPools: Set<string>,
  poolByVmid: Map<number, string>,
): BackupRunsResult {
  const result = buildBackupRunsResult(raw, tenantOwnsTask(allowedPools, poolByVmid))
  const manualRuns = result.manual.runs.map(withoutSharedWith)
  const jobs = result.jobs
    .filter(j => isJobOwnedByTenantPools(j, allowedPools))
    .map(j => {
      const runs = j.runs.map(withoutSharedWith)

      return { ...j, runs, lastRun: runs[0] ?? null }
    })

  return {
    ...result,
    jobs,
    manual: { lastRun: manualRuns[0] ?? null, runs: manualRuns },
    unreachableNodes: [],
    truncatedNodes: [],
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
