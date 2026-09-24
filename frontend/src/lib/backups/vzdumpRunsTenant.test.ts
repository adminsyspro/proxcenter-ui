import { describe, it, expect } from 'vitest'

import { parseVzdumpCommandLine } from './vzdumpCommandLine'
import type { TaskLogSummary } from './vzdumpLog'
import type { TaskFacts } from './vzdumpRuns'
import { buildBackupRunsResult, type BackupRunsRaw } from './vzdumpRunsService'
import { filterBackupRunsForTenant, isTaskVisible, tenantOwnsTask } from './vzdumpRunsTenant'

const PREFIX = 'INFO: starting new backup job: vzdump '

function task(
  upid: string,
  node: string,
  line: string,
  times: { start: number; end?: number; status?: string },
  log: TaskLogSummary | null = null,
): TaskFacts {
  return {
    task: { upid, node, starttime: times.start, endtime: times.end ?? times.start + 60, status: times.status ?? 'OK', user: 'root@pam' },
    invocation: parseVzdumpCommandLine(PREFIX + line),
    log,
  }
}

// vdc-a owns guest 105, the provider's infra pool owns 100.
const POOLS = new Map<number, string>([[105, 'vdc-a'], [100, 'infra']])
const MINE = new Set(['vdc-a'])

// Two jobs with the same options: "mine" on pool vdc-a, "provider" on 100.
const MINE_JOB = { id: 'mine', type: 'vzdump', schedule: '01:00', storage: 'pbs', mode: 'snapshot', pool: 'vdc-a' }
const PROVIDER_JOB = { id: 'provider', type: 'vzdump', schedule: '01:00', storage: 'pbs', mode: 'snapshot', vmid: '100' }

const raw = (facts: TaskFacts[], jobs: Record<string, any>[] = [MINE_JOB, PROVIDER_JOB]): BackupRunsRaw => ({
  jobs, facts, unreachableNodes: ['pve3'], truncatedNodes: ['pve1'], since: 0, days: 30,
})

describe('filterBackupRunsForTenant', () => {
  const facts = [
    task('U1', 'pve1', '--pool vdc-a --storage pbs --mode snapshot --quiet 1', { start: 1000 }, { guests: [{ vmid: 105, status: 'ok', step: null, reason: null }], taskError: null }),
    task('U2', 'pve1', '100 --storage pbs --mode snapshot --quiet 1', { start: 5000 }),
    task('U3', 'pve2', '105 --storage local --mode stop', { start: 300 }),
    task('U4', 'pve2', '105 100 --storage local --mode stop', { start: 200 }),
    task('U5', 'pve2', '--all 1 --storage local --mode stop', { start: 100 }), // log gone: no guest known
  ]
  const out = filterBackupRunsForTenant(raw(facts), MINE, POOLS)

  it('keeps only jobs on the tenant pools', () => {
    expect(out.jobs.map(j => j.jobId)).toEqual(['mine'])
    expect(out.jobs[0].lastRun?.id).toBe('U1')
  })

  it('keeps a manual run only when every vmid is the tenant’s', () => {
    expect(out.manual.runs.map(r => r.id)).toEqual(['U3'])
    expect(out.manual.lastRun?.id).toBe('U3')
  })

  it('empties the cluster-health node lists (the provider’s business)', () => {
    expect(out.unreachableNodes).toEqual([])
    expect(out.truncatedNodes).toEqual([])
  })
})

describe('tenantOwnsTask', () => {
  const owns = tenantOwnsTask(MINE, POOLS)

  it('reads the guests from the log summary, else from the command line', () => {
    expect(owns(task('A', 'pve1', '105 --storage x', { start: 1 }))).toBe(true)
    expect(owns(task('B', 'pve1', '105 100 --storage x', { start: 1 }))).toBe(false)
    expect(owns(task('C', 'pve1', '--pool vdc-a --storage x', { start: 1 }))).toBe(false) // no guest known
    expect(owns(task('D', 'pve1', '--pool vdc-a --storage x', { start: 1 }, { guests: [{ vmid: 105, status: 'ok', step: null, reason: null }], taskError: null }))).toBe(true)
  })
})

describe('isTaskVisible', () => {
  it('finds a task in a job run or a manual run', () => {
    const result = buildBackupRunsResult(raw([
      task('U2', 'pve1', '100 --storage pbs --mode snapshot --quiet 1', { start: 5000 }),
      task('U4', 'pve2', '105 100 --storage local --mode stop', { start: 200 }),
    ]))
    expect(isTaskVisible(result, 'pve1', 'U2')).toBe(true)
    expect(isTaskVisible(result, 'pve2', 'U4')).toBe(true)
    expect(isTaskVisible(result, 'pve1', 'U4')).toBe(false)
    expect(isTaskVisible(result, 'pve1', 'nope')).toBe(false)
  })
})

// jobMatches attaches tasks to a job by vzdump options, not by who owns the
// guests: a foreign vmid-list task (another tenant, the provider, a "Run now"
// replay of a pool job) can fall in a run of the tenant's own pool job. The
// tenant view drops foreign tasks before runs are formed.
describe('filterBackupRunsForTenant — per-task job run scoping', () => {
  const POOL_LINE = '--pool vdc-a --storage pbs --mode snapshot --quiet 1'
  // A "Run now" replay of the pool job: one vmid list per node.
  const replay = (vmid: number) => `${vmid} --node pve1 --storage pbs --mode snapshot`
  const mineOnly = [MINE_JOB]

  it('computes a run over the owned tasks only: status, total, reason, id and times (#1003 final review F1)', () => {
    const own = task('OWN', 'pve2', replay(105), { start: 1010, end: 1100, status: 'OK' })
    const foreign = task('FOREIGN', 'pve1', replay(100), { start: 1000, end: 1500, status: 'job errors' }, {
      guests: [{ vmid: 100, status: 'failed', step: null, reason: "other tenant's disk is gone" }],
      taskError: 'job errors',
    })
    const provider = buildBackupRunsResult(raw([foreign, own], mineOnly))
    expect(provider.jobs[0].runs[0]).toMatchObject({ id: 'FOREIGN', status: 'partial' }) // the whole group

    const out = filterBackupRunsForTenant(raw([foreign, own], mineOnly), MINE, POOLS)
    const [run] = out.jobs[0].runs
    expect(run).toMatchObject({ id: 'OWN', start: 1010, end: 1100, durationSec: 90, status: 'ok', statusDetail: { failed: 0, total: 1 } })
    expect(run.statusDetail.reason).toBeUndefined()
    expect(run.tasks.map(t => t.upid)).toEqual(['OWN'])
  })

  it('drops a job run left with no owned task and promotes the next run to lastRun', () => {
    const out = filterBackupRunsForTenant(raw([
      task('FOREIGN', 'pve1', replay(100), { start: 20_000 }),
      task('OWNED', 'pve1', replay(105), { start: 10 }),
    ], mineOnly), MINE, POOLS)
    expect(out.jobs[0].runs.map(r => r.id)).toEqual(['OWNED'])
    expect(out.jobs[0].lastRun?.id).toBe('OWNED')
  })

  it('sets lastRun to null when an owned job has no owned task at all', () => {
    const out = filterBackupRunsForTenant(raw([task('FOREIGN', 'pve1', replay(100), { start: 20 })], mineOnly), MINE, POOLS)
    expect(out.jobs[0].runs).toEqual([])
    expect(out.jobs[0].lastRun).toBeNull()
  })

  it('strips sharedWith from every run returned to a tenant', () => {
    const twin = { ...MINE_JOB, id: 'z-twin', pool: 'vdc-a' }
    const facts = [task('T', 'pve1', POOL_LINE, { start: 10 }, { guests: [{ vmid: 105, status: 'ok', step: null, reason: null }], taskError: null })]
    const provider = buildBackupRunsResult(raw(facts, [MINE_JOB, twin]))
    expect(provider.jobs.find(j => j.jobId === 'mine')!.runs[0].sharedWith).toEqual(['z-twin'])

    const out = filterBackupRunsForTenant(raw(facts, [MINE_JOB, twin]), MINE, POOLS)
    expect(out.jobs.flatMap(j => j.runs).every(r => r.sharedWith === undefined)).toBe(true)
  })

  it('hides a foreign task of a job run from isTaskVisible', () => {
    const out = filterBackupRunsForTenant(raw([
      task('MIX-A', 'pve1', replay(105), { start: 10 }),
      task('MIX-B', 'pve4', replay(100), { start: 12 }),
    ], mineOnly), MINE, POOLS)
    expect(isTaskVisible(out, 'pve4', 'MIX-B')).toBe(false)
    expect(isTaskVisible(out, 'pve1', 'MIX-A')).toBe(true)
  })
})
