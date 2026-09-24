/**
 * Tenant scoping of the backup run history (issue #1003), same contract as the
 * jobs list (lib/vdc/backupJobs.ts): an iaas (vDC) tenant sees the runs of the
 * jobs on its own pools, and manual runs only when every guest they backed up
 * is in one of its pools. Provider and MSP tenants get the unfiltered result
 * (callers skip this when getAllowedJobPools returns null).
 */

import type { PveConn } from '@/lib/connections/getConnection'
import { pveFetch } from '@/lib/proxmox/client'

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
  const runs = result.manual.runs.filter(r => {
    const vmids = r.tasks.flatMap(t => t.vmids)
    return vmids.length > 0 && vmids.every(owns)
  })

  return {
    ...result,
    jobs: result.jobs.filter(j => j.pool !== null && allowedPools.has(j.pool)),
    manual: { lastRun: runs[0] ?? null, runs },
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
