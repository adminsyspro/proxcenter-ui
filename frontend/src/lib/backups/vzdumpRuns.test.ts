import { describe, it, expect } from 'vitest'

import pruneFailed from './__fixtures__/vzdump/scheduled-pbs-prune-failed.json'
import { jobInvocation, parseVzdumpCommandLine } from './vzdumpCommandLine'
import { parseVzdumpLog, summarizeVzdumpLog, type ParsedVzdumpLog, type TaskLogLine, type TaskLogSummary } from './vzdumpLog'
import { buildRunHistory, isTaskRunning, jobMatches, type TaskFacts, type VzdumpTaskEntry } from './vzdumpRuns'

const PREFIX = 'INFO: starting new backup job: vzdump '

let seq = 0
function facts(
  line: string,
  task: Partial<VzdumpTaskEntry> & { starttime: number },
  log: TaskLogSummary | null = null,
): TaskFacts {
  seq++
  const full: VzdumpTaskEntry = {
    upid: `UPID:${task.node ?? 'pve1'}:${seq}:vzdump::root@pam:`,
    node: 'pve1',
    endtime: task.starttime + 60,
    status: 'OK',
    user: 'root@pam',
    ...task,
  }
  return { task: full, invocation: parseVzdumpCommandLine(PREFIX + line), log }
}

const DAILY = { id: 'backup-daily', type: 'vzdump', schedule: '02:00', storage: 'pbs', mode: 'snapshot', compress: 'zstd', all: 1, exclude: '9000' }
const WEEKLY = { id: 'backup-weekly', type: 'vzdump', schedule: 'sat 03:00', storage: 'local', mode: 'stop', vmid: '100,103' }
const POOL = { id: 'backup-pool', type: 'vzdump', schedule: '01:00', storage: 'pbs', mode: 'snapshot', pool: 'tenant-a' }
const PINNED = { id: 'backup-pinned', type: 'vzdump', schedule: '04:00', storage: 'local', node: 'pve2', vmid: '200' }
const JOBS = [DAILY, WEEKLY, POOL, PINNED].map(raw => ({ id: raw.id, raw }))

describe('jobMatches', () => {
  const inv = (l: string) => parseVzdumpCommandLine(PREFIX + l)!

  it('all-guest job: needs --all and the same exclude set', () => {
    const job = jobInvocation(DAILY)
    expect(jobMatches(job, inv('--all 1 --exclude 9000 --storage pbs --mode snapshot --compress zstd --quiet 1'))).toBe(true)
    expect(jobMatches(job, inv('--all 1 --storage pbs --mode snapshot --compress zstd'))).toBe(false)
    expect(jobMatches(job, inv('100 --storage pbs --mode snapshot --compress zstd'))).toBe(false)
  })

  it('vmid job: a subset of its vmids matches (Run now per node), a foreign vmid does not', () => {
    const job = jobInvocation(WEEKLY)
    expect(jobMatches(job, inv('103 --node pve2 --storage local --mode stop'))).toBe(true)
    expect(jobMatches(job, inv('103 104 --storage local --mode stop'))).toBe(false)
  })

  it('pool job: same --pool, or a vmid list replayed by Run now', () => {
    const job = jobInvocation(POOL)
    expect(jobMatches(job, inv('--pool tenant-a --storage pbs --mode snapshot --quiet 1'))).toBe(true)
    expect(jobMatches(job, inv('105 106 --node pve1 --storage pbs --mode snapshot'))).toBe(true)
    expect(jobMatches(job, inv('--pool tenant-b --storage pbs --mode snapshot'))).toBe(false)
  })

  it('a different option value never matches', () => {
    expect(jobMatches(jobInvocation(WEEKLY), inv('100 --storage local --mode snapshot'))).toBe(false)
  })

  it('an extra option never matches', () => {
    expect(jobMatches(jobInvocation(WEEKLY), inv('100 --storage local --mode stop --protected 1'))).toBe(false)
  })

  it('node: must be equal for a pinned job, ignored for an unpinned one', () => {
    expect(jobMatches(jobInvocation(PINNED), inv('200 --node pve2 --storage local'))).toBe(true)
    expect(jobMatches(jobInvocation(PINNED), inv('200 --node pve1 --storage local'))).toBe(false)
    expect(jobMatches(jobInvocation(WEEKLY), inv('100 --node pve3 --storage local --mode stop'))).toBe(true)
  })
})

describe('buildRunHistory', () => {
  it('groups the per-node tasks of one scheduled run and marks it scheduled', () => {
    const line = '--all 1 --exclude 9000 --storage pbs --mode snapshot --compress zstd --quiet 1'
    const h = buildRunHistory(JOBS, [
      facts(line, { node: 'pve1', starttime: 1000 }),
      facts(line, { node: 'pve2', starttime: 1002, endtime: 1300 }),
    ])
    const runs = h.byJob.get('backup-daily')!
    expect(runs).toHaveLength(1)
    expect(runs[0]).toMatchObject({ start: 1000, end: 1300, durationSec: 300, origin: 'scheduled', status: 'ok' })
    expect(runs[0].tasks.map(t => t.node)).toEqual(['pve1', 'pve2'])
  })

  it('opens a new run after the window and lists runs newest first', () => {
    const line = '--all 1 --exclude 9000 --storage pbs --mode snapshot --compress zstd --quiet 1'
    const h = buildRunHistory(JOBS, [facts(line, { starttime: 1000 }), facts(line, { starttime: 1000 + 86400 })])
    expect(h.byJob.get('backup-daily')!.map(r => r.start)).toEqual([1000 + 86400, 1000])
  })

  it('two Run now within 10 minutes on the same node stay two runs', () => {
    const line = '100 --node pve1 --storage local --mode stop'
    const h = buildRunHistory(JOBS, [
      facts(line, { starttime: 1000, tokenid: 'root' }),
      facts(line, { starttime: 1120, tokenid: 'root' }),
    ])
    const runs = h.byJob.get('backup-weekly')!
    expect(runs).toHaveLength(2)
    expect(runs.every(r => r.origin === 'manual')).toBe(true)
  })

  it('a task no job accounts for goes to the manual row, one run each', () => {
    const h = buildRunHistory(JOBS, [
      facts('555 --node pve1 --storage local --mode snapshot', { starttime: 10 }),
      facts('556 --node pve1 --storage local --mode snapshot', { starttime: 20 }),
    ])
    expect(h.manual).toHaveLength(2)
    expect(h.manual[0].tasks[0].vmids).toEqual([556])
  })

  it('runs of a job edited since (older options) land in the manual row', () => {
    const before = facts('100 --storage local --mode snapshot --quiet 1', { starttime: 10 }) // job was mode=snapshot
    const h = buildRunHistory(JOBS, [before])
    expect(h.byJob.get('backup-weekly')).toEqual([])
    expect(h.manual).toHaveLength(1)
  })

  it('a task whose log is gone is manual and flagged logUnavailable', () => {
    const f: TaskFacts = { task: { upid: 'UPID:pve1:9:vzdump:100:root@pam:', node: 'pve1', starttime: 5, endtime: 6, status: 'OK' }, invocation: null, log: null }
    const h = buildRunHistory(JOBS, [f])
    expect(h.manual[0].tasks[0].logUnavailable).toBe(true)
  })

  it('identical job signatures: first job by id takes the run, the other is named', () => {
    const twin = { ...WEEKLY, id: 'backup-a-twin' }
    const h = buildRunHistory([...JOBS, { id: twin.id, raw: twin }], [facts('100 --storage local --mode stop --quiet 1', { starttime: 1 })])
    expect(h.byJob.get('backup-a-twin')![0].sharedWith).toEqual(['backup-weekly'])
    expect(h.byJob.get('backup-weekly')).toEqual([])
  })

  it("aggregates the reporter's case as post_step_failed / prune", () => {
    const log = parseVzdumpLog(pruneFailed as TaskLogLine[], { taskStart: 1790256602 })
    const f = facts('9882 --storage pbs --mode snapshot', { starttime: 1790256602, status: 'job errors' }, log)
    const run = buildRunHistory([], [f]).manual[0]
    expect(run.status).toBe('post_step_failed')
    expect(run.statusDetail).toMatchObject({ step: 'prune', failed: 1, total: 1 })
  })

  it('partial when one guest of several failed; failed when all did', () => {
    const mk = (statuses: Array<'ok' | 'failed'>): ParsedVzdumpLog => ({
      commandLine: null, jobLines: [], taskError: 'job errors', taskWarnings: 0,
      guests: statuses.map((s, i) => ({
        vmid: 100 + i, type: 'qemu', name: null, start: null, end: null, durationSec: null, archive: null, namespace: null,
        transferredBytes: null, reusedBytes: null, reusedPercent: null, zeroBytes: null, archiveSizeBytes: null,
        warnings: [], errors: [], status: s, step: null, reason: s === 'failed' ? 'boom' : null, lines: [],
      })),
    })
    const partial = buildRunHistory([], [facts('--pool p --storage x', { starttime: 1, status: 'job errors' }, mk(['ok', 'failed']))]).manual[0]
    expect(partial).toMatchObject({ status: 'partial', statusDetail: { failed: 1, total: 2, reason: 'boom' } })
    const failed = buildRunHistory([], [facts('--pool p --storage x', { starttime: 1, status: 'job errors' }, mk(['failed']))]).manual[0]
    expect(failed.status).toBe('failed')
  })

  it('a task error without guest section is one failed unit carrying the task error', () => {
    const log: ParsedVzdumpLog = { commandLine: null, guests: [], jobLines: [], taskError: "storage 'pbs' is not online", taskWarnings: 0 }
    const run = buildRunHistory([], [facts('100 --storage pbs', { starttime: 1, status: "storage 'pbs' is not online" }, log)]).manual[0]
    expect(run).toMatchObject({ status: 'failed', statusDetail: { failed: 1, total: 1, reason: "storage 'pbs' is not online" } })
  })

  it('WARNINGS task without parsed log is a warning; a running task makes the run running', () => {
    const warn = buildRunHistory([], [facts('100 --storage pbs', { starttime: 1, status: 'WARNINGS: 1' })]).manual[0]
    expect(warn.status).toBe('warning')
    const running = buildRunHistory([], [facts('100 --storage pbs', { starttime: 1, status: undefined, endtime: undefined })]).manual[0]
    expect(running).toMatchObject({ status: 'running', end: null, durationSec: null })
    expect(running.tasks[0].status).toBe('running')
  })
})

describe('buildRunHistory — keepTask (#1003 final review)', () => {
  const line = '--all 1 --exclude 9000 --storage pbs --mode snapshot --compress zstd --quiet 1'
  const guest = (vmid: number, status: 'ok' | 'failed', reason: string | null = null) =>
    ({ vmid, status, step: null, reason })

  it('drops tasks before grouping, so the run is computed over the kept ones only', () => {
    const foreign = facts(line, { node: 'pve1', starttime: 1000, endtime: 1500, status: 'job errors' }, {
      guests: [guest(100, 'failed', 'foreign failure')], taskError: 'job errors',
    })
    const own = facts(line, { node: 'pve2', starttime: 1010, endtime: 1100, status: 'OK' }, {
      guests: [guest(105, 'ok')], taskError: null,
    })
    const h = buildRunHistory(JOBS, [foreign, own], undefined, f => f.task.upid === own.task.upid)
    const [run] = h.byJob.get('backup-daily')!
    expect(run).toMatchObject({ id: own.task.upid, start: 1010, end: 1100, status: 'ok', statusDetail: { failed: 0, total: 1 } })
    expect(run.statusDetail.reason).toBeUndefined()
    expect(run.tasks.map(t => t.upid)).toEqual([own.task.upid])
  })

  it('works from a compact log summary exactly as from a parsed log', () => {
    const log = parseVzdumpLog(pruneFailed as TaskLogLine[], { taskStart: 1790256602 })
    const f = facts('9882 --storage pbs --mode snapshot', { starttime: 1790256602, status: 'job errors' }, log)
    const fromParsed = buildRunHistory([], [f]).manual[0]
    const fromSummary = buildRunHistory([], [{ ...f, log: summarizeVzdumpLog(log) }]).manual[0]
    expect(fromSummary).toEqual(fromParsed)
    expect(fromSummary.status).toBe('post_step_failed')
  })
})

// Lab E2E: PVE's task list sets status 'RUNNING' on an active task
// (PVE/API2/Tasks.pm: `$task->{status} = 'RUNNING' if !$task->{status}`).
describe('a task PVE lists as RUNNING', () => {
  it('makes its run running, not failed with reason "RUNNING"', () => {
    const run = buildRunHistory([], [facts('100 --storage pbs', { starttime: 1, status: 'RUNNING', endtime: undefined })]).manual[0]
    expect(run).toMatchObject({ status: 'running', end: null, durationSec: null })
    expect(run.statusDetail.reason).toBeUndefined()
    expect(run.tasks[0].status).toBe('running')
  })

  it('isTaskRunning: RUNNING, or neither status nor end time', () => {
    expect(isTaskRunning({ upid: 'U', node: 'n', starttime: 1, status: 'RUNNING' })).toBe(true)
    expect(isTaskRunning({ upid: 'U', node: 'n', starttime: 1 })).toBe(true)
    expect(isTaskRunning({ upid: 'U', node: 'n', starttime: 1, endtime: 2, status: 'OK' })).toBe(false)
  })
})
