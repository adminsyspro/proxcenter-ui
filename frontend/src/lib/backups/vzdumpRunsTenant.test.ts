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

// --- Fix round 1 (#1003 review): jobMatches can attach a vmid-list task of
// another tenant (or the provider) to a tenant's own pool job — same
// options (e.g. shared PBS storage/schedule), or a "Run now" replay of a
// pool job as a vmid list. filterBackupRunsForTenant must scope a job run
// per task, exactly like a manual run, instead of trusting job/pool
// ownership alone for the whole run.

const taskOf = (node: string, upid: string, vmids: number[]) =>
  ({ node, upid, status: 'OK', start: 1, end: 2, vmids, logUnavailable: false })

const runWithTasks = (id: string, start: number, tasks: ReturnType<typeof taskOf>[]): RunSummary => ({
  id,
  start,
  end: start + 1,
  durationSec: 1,
  origin: 'scheduled',
  status: 'ok',
  statusDetail: { failed: 0, total: tasks.length },
  sharedWith: ['other-job'],
  tasks,
})

describe('filterBackupRunsForTenant — per-task job run scoping', () => {
  it('keeps only the owned task of a job run that also carries a foreign vmid', () => {
    const mixed = runWithTasks('MIX', 10, [
      taskOf('pve1', 'MIX-A', [105]), // owned (vdc-a)
      taskOf('pve4', 'MIX-B', [100]), // foreign (infra)
    ])
    const result: BackupRunsResult = {
      jobs: [{ jobId: 'mine', pool: 'vdc-a', nextRun: null, lastRun: mixed, runs: [mixed] }],
      manual: { lastRun: null, runs: [] },
      unreachableNodes: [],
      window: { since: 0, days: 30 },
    }

    const out = filterBackupRunsForTenant(result, new Set(['vdc-a']), POOLS)

    expect(out.jobs[0].runs).toHaveLength(1)
    expect(out.jobs[0].runs[0].tasks.map(t => t.upid)).toEqual(['MIX-A'])
  })

  it('drops a job run left with no owned task and promotes the next run to lastRun', () => {
    const foreignOnly = runWithTasks('FOREIGN', 20, [taskOf('pve4', 'F-1', [100])])
    const owned = runWithTasks('OWNED', 10, [taskOf('pve1', 'O-1', [105])])
    const result: BackupRunsResult = {
      jobs: [{ jobId: 'mine', pool: 'vdc-a', nextRun: null, lastRun: foreignOnly, runs: [foreignOnly, owned] }],
      manual: { lastRun: null, runs: [] },
      unreachableNodes: [],
      window: { since: 0, days: 30 },
    }

    const out = filterBackupRunsForTenant(result, new Set(['vdc-a']), POOLS)

    expect(out.jobs[0].runs.map(r => r.id)).toEqual(['OWNED'])
    expect(out.jobs[0].lastRun?.id).toBe('OWNED')
  })

  it('sets lastRun to null when every run of an owned job loses all its tasks', () => {
    const foreignOnly = runWithTasks('FOREIGN', 20, [taskOf('pve4', 'F-1', [100])])
    const result: BackupRunsResult = {
      jobs: [{ jobId: 'mine', pool: 'vdc-a', nextRun: null, lastRun: foreignOnly, runs: [foreignOnly] }],
      manual: { lastRun: null, runs: [] },
      unreachableNodes: [],
      window: { since: 0, days: 30 },
    }

    const out = filterBackupRunsForTenant(result, new Set(['vdc-a']), POOLS)

    expect(out.jobs[0].runs).toEqual([])
    expect(out.jobs[0].lastRun).toBeNull()
  })

  it('strips sharedWith from every run returned to a tenant', () => {
    const mixed = runWithTasks('MIX', 10, [taskOf('pve1', 'MIX-A', [105])])
    const manualRun = runWithTasks('M1', 5, [taskOf('pve2', 'M1-A', [105])])
    const result: BackupRunsResult = {
      jobs: [{ jobId: 'mine', pool: 'vdc-a', nextRun: null, lastRun: mixed, runs: [mixed] }],
      manual: { lastRun: manualRun, runs: [manualRun] },
      unreachableNodes: [],
      window: { since: 0, days: 30 },
    }

    const out = filterBackupRunsForTenant(result, new Set(['vdc-a']), POOLS)

    expect(out.jobs[0].runs[0].sharedWith).toBeUndefined()
    expect(out.manual.runs[0].sharedWith).toBeUndefined()
  })

  it('hides a foreign task dropped from a job run from isTaskVisible', () => {
    const mixed = runWithTasks('MIX', 10, [
      taskOf('pve1', 'MIX-A', [105]),
      taskOf('pve4', 'MIX-B', [100]),
    ])
    const result: BackupRunsResult = {
      jobs: [{ jobId: 'mine', pool: 'vdc-a', nextRun: null, lastRun: mixed, runs: [mixed] }],
      manual: { lastRun: null, runs: [] },
      unreachableNodes: [],
      window: { since: 0, days: 30 },
    }

    const out = filterBackupRunsForTenant(result, new Set(['vdc-a']), POOLS)

    expect(isTaskVisible(out, 'pve4', 'MIX-B')).toBe(false)
    expect(isTaskVisible(out, 'pve1', 'MIX-A')).toBe(true)
  })
})
