import { describe, it, expect } from 'vitest'

import type { BackupRunsResult } from './vzdumpRunsService'
import type { RunSummary } from './vzdumpRuns'
import { filterBackupRunsForTenant, isTaskVisible } from './vzdumpRunsTenant'

const run = (upid: string, node: string, vmids: number[]): RunSummary => ({
  id: upid, start: 1, end: 2, durationSec: 1, origin: 'manual', status: 'ok', statusDetail: { failed: 0, total: vmids.length },
  tasks: [{ node, upid, status: 'OK', start: 1, end: 2, vmids, logUnavailable: false }],
})

const RESULT: BackupRunsResult = {
  jobs: [
    { jobId: 'mine', pool: 'vdc-a', nextRun: null, lastRun: run('U1', 'pve1', [105]), runs: [run('U1', 'pve1', [105])] },
    { jobId: 'provider', pool: null, nextRun: null, lastRun: run('U2', 'pve1', [100]), runs: [run('U2', 'pve1', [100])] },
  ],
  manual: {
    lastRun: run('U3', 'pve2', [105]),
    runs: [run('U3', 'pve2', [105]), run('U4', 'pve2', [105, 100]), run('U5', 'pve2', [])],
  },
  unreachableNodes: ['pve3'],
  window: { since: 0, days: 30 },
}

const POOLS = new Map<number, string>([[105, 'vdc-a'], [100, 'infra']])

describe('filterBackupRunsForTenant', () => {
  const out = filterBackupRunsForTenant(RESULT, new Set(['vdc-a']), POOLS)

  it('keeps only jobs on the tenant pools', () => {
    expect(out.jobs.map(j => j.jobId)).toEqual(['mine'])
  })

  it('keeps a manual run only when every vmid is the tenant’s', () => {
    expect(out.manual.runs.map(r => r.id)).toEqual(['U3'])
    expect(out.manual.lastRun?.id).toBe('U3')
  })

  it('hides node names the tenant has no business seeing', () => {
    expect(out.unreachableNodes).toEqual([])
  })
})

describe('isTaskVisible', () => {
  it('finds a task in a job run or a manual run', () => {
    expect(isTaskVisible(RESULT, 'pve1', 'U2')).toBe(true)
    expect(isTaskVisible(RESULT, 'pve2', 'U4')).toBe(true)
    expect(isTaskVisible(RESULT, 'pve1', 'U4')).toBe(false)
    expect(isTaskVisible(RESULT, 'pve1', 'nope')).toBe(false)
  })
})
