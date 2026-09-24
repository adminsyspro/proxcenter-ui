import { describe, it, expect, vi, beforeEach } from 'vitest'

import pruneFailed from './__fixtures__/vzdump/scheduled-pbs-prune-failed.json'
import { resetVzdumpRunCaches } from './vzdumpRunCache'

const pveFetchMock = vi.fn<(...args: any[]) => Promise<any>>()
vi.mock('@/lib/proxmox/client', () => ({ pveFetch: pveFetchMock }))

const conn = { id: 'conn-1' } as any
const NOW = 1790260000_000
const SCHED_UPID = 'UPID:pve1:001C9B56:09EE7859:6AB525DA:vzdump:9882:root@pam:'
const MANUAL_UPID = 'UPID:pve2:00271E2C:07FF3A42:6AB031D2:vzdump:111:root@pam!root:'
const GONE_UPID = 'UPID:pve2:0000AAAA:07FF0000:6AB00000:vzdump:107:root@pam!root:'
const RUNNING_UPID = 'UPID:pve2:0000BBBB:07FF1111:6AB52700:vzdump:103:root@pam!root:'

const PROBE_JOB = {
  id: 'e2e-1003-probe', type: 'vzdump', enabled: 1, schedule: '15:28', 'next-run': 1790342880,
  storage: 'pbs-msp-msppveprod', mode: 'snapshot', compress: 'zstd', vmid: '9882',
  'notes-template': '{{guestname}} probe', 'prune-backups': { 'keep-daily': '2', 'keep-last': '3' },
}

const tasksByNode: Record<string, any[]> = {
  pve1: [{ upid: SCHED_UPID, node: 'pve1', starttime: 1790256602, endtime: 1790256604, status: 'job errors', user: 'root@pam', type: 'vzdump' }],
  pve2: [
    { upid: MANUAL_UPID, node: 'pve2', starttime: 1789931986, endtime: 1789931987, status: 'OK', user: 'root@pam', tokenid: 'root', type: 'vzdump' },
    { upid: GONE_UPID, node: 'pve2', starttime: 1789000000, endtime: 1789000100, status: 'OK', user: 'root@pam', tokenid: 'root', type: 'vzdump' },
    { upid: RUNNING_UPID, node: 'pve2', starttime: 1790259900, user: 'root@pam', tokenid: 'root', type: 'vzdump' },
  ],
}

const FIRST: Record<string, string | null> = {
  [SCHED_UPID]: (pruneFailed as any[])[0].t,
  [MANUAL_UPID]: 'INFO: starting new backup job: vzdump 111 --compress zstd --node pve2 --mode stop --storage pbs-msp-msppveprod',
  [GONE_UPID]: null,
  [RUNNING_UPID]: 'INFO: starting new backup job: vzdump 103 --node pve2 --storage local --mode snapshot',
}

const RUNNING_LOG = [
  { n: 1, t: FIRST[RUNNING_UPID]! },
  { n: 2, t: 'INFO: Starting Backup of VM 103 (qemu)' },
  { n: 3, t: 'INFO: Backup started at 2026-09-24 16:05:00' },
]

let logCalls: string[]

function wire(nodes = [{ node: 'pve1', status: 'online' }, { node: 'pve2', status: 'online' }, { node: 'pve3', status: 'offline' }]) {
  pveFetchMock.mockImplementation(async (_c: any, path: string) => {
    if (path === '/cluster/backup') return [PROBE_JOB]
    if (path === '/nodes') return nodes
    const list = path.match(/^\/nodes\/([^/]+)\/tasks\?(.*)$/)
    if (list) return tasksByNode[list[1]] ?? []
    const log = path.match(/^\/nodes\/[^/]+\/tasks\/([^/]+)\/log\?start=(\d+)&limit=(\d+)$/)
    if (log) {
      const upid = decodeURIComponent(log[1])
      logCalls.push(`${upid}:${log[3]}`)
      if (upid === GONE_UPID) throw new Error("unable to open file '/var/log/pve/tasks/…' - No such file")
      if (log[3] === '1') return FIRST[upid] ? [{ n: 1, t: FIRST[upid] }] : []
      if (upid === SCHED_UPID) return pruneFailed
      if (upid === RUNNING_UPID) return RUNNING_LOG
      return []
    }
    throw new Error(`unexpected path ${path}`)
  })
}

beforeEach(() => {
  resetVzdumpRunCaches()
  pveFetchMock.mockReset()
  logCalls = []
  wire()
})

describe('clampDays', () => {
  it('defaults to 30 and clamps to 1..90', async () => {
    const { clampDays } = await import('./vzdumpRunsService')
    expect(clampDays(null)).toBe(30)
    expect(clampDays('7')).toBe(7)
    expect(clampDays('500')).toBe(90)
    expect(clampDays('-3')).toBe(1)
    expect(clampDays('abc')).toBe(30)
  })
})

describe('collectBackupRuns', () => {
  it('queries every online node with typefilter, source=all and since', async () => {
    const { collectBackupRuns } = await import('./vzdumpRunsService')
    await collectBackupRuns(conn, 'conn-1', { days: 30, now: NOW })
    const listCalls = pveFetchMock.mock.calls.map(c => c[1] as string).filter(p => p.includes('/tasks?'))
    expect(listCalls).toEqual([
      `/nodes/pve1/tasks?typefilter=vzdump&source=all&since=${Math.floor(NOW / 1000) - 30 * 86400}&limit=1000`,
      `/nodes/pve2/tasks?typefilter=vzdump&source=all&since=${Math.floor(NOW / 1000) - 30 * 86400}&limit=1000`,
    ])
  })

  it("attaches the scheduled run to its job with the reporter's derived status", async () => {
    const { collectBackupRuns } = await import('./vzdumpRunsService')
    const r = await collectBackupRuns(conn, 'conn-1', { days: 30, now: NOW })
    expect(r.jobs).toHaveLength(1)
    expect(r.jobs[0]).toMatchObject({ jobId: 'e2e-1003-probe', nextRun: 1790342880, pool: null })
    expect(r.jobs[0].lastRun).toMatchObject({ origin: 'scheduled', status: 'post_step_failed', statusDetail: { step: 'prune' } })
  })

  it('reads only the first line of an OK task with positional vmids', async () => {
    const { collectBackupRuns } = await import('./vzdumpRunsService')
    await collectBackupRuns(conn, 'conn-1', { days: 30, now: NOW })
    expect(logCalls.filter(c => c.startsWith(MANUAL_UPID))).toEqual([`${MANUAL_UPID}:1`])
  })

  it('lists an unreadable log in the manual row, flagged, and retries it next time', async () => {
    const { collectBackupRuns } = await import('./vzdumpRunsService')
    const r = await collectBackupRuns(conn, 'conn-1', { days: 30, now: NOW })
    const gone = r.manual.runs.find(run => run.id === GONE_UPID)!
    expect(gone.tasks[0].logUnavailable).toBe(true)
    await collectBackupRuns(conn, 'conn-1', { days: 30, now: NOW, noCache: true })
    expect(logCalls.filter(c => c === `${GONE_UPID}:1`)).toHaveLength(2)
  })

  it('shows a running task as running and never caches its parsed log', async () => {
    const { collectBackupRuns } = await import('./vzdumpRunsService')
    const r = await collectBackupRuns(conn, 'conn-1', { days: 30, now: NOW })
    expect(r.manual.runs.find(run => run.id === RUNNING_UPID)!.status).toBe('running')
    await collectBackupRuns(conn, 'conn-1', { days: 30, now: NOW, noCache: true })
    expect(logCalls.filter(c => c === `${RUNNING_UPID}:5000`)).toHaveLength(2)
  })

  it('caches finished logs and the whole result for 30 s', async () => {
    const { collectBackupRuns } = await import('./vzdumpRunsService')
    await collectBackupRuns(conn, 'conn-1', { days: 30, now: NOW })
    const calls = pveFetchMock.mock.calls.length
    await collectBackupRuns(conn, 'conn-1', { days: 30, now: NOW + 10_000 })
    expect(pveFetchMock.mock.calls.length).toBe(calls) // result cache hit
    await collectBackupRuns(conn, 'conn-1', { days: 30, now: NOW + 31_000 })
    expect(logCalls.filter(c => c === `${SCHED_UPID}:5000`)).toHaveLength(1) // parsed log cached
  })

  it('reports offline and failing nodes as unreachable', async () => {
    const { collectBackupRuns } = await import('./vzdumpRunsService')
    const base = pveFetchMock.getMockImplementation()!
    pveFetchMock.mockImplementation(async (c: any, path: string, ...rest: any[]) => {
      if (path.startsWith('/nodes/pve2/tasks?')) throw new Error('595 no route')
      return base(c, path, ...rest)
    })
    const r = await collectBackupRuns(conn, 'conn-1', { days: 30, now: NOW })
    expect(r.unreachableNodes.sort()).toEqual(['pve2', 'pve3'])
  })
})

describe('loadRunTaskDetail', () => {
  it('returns the task status and the parsed log', async () => {
    const { loadRunTaskDetail } = await import('./vzdumpRunsService')
    const base = pveFetchMock.getMockImplementation()!
    pveFetchMock.mockImplementation(async (c: any, path: string, ...rest: any[]) => {
      if (path.endsWith('/status')) {
        return { status: 'stopped', exitstatus: 'job errors', starttime: 1790256602, endtime: 1790256604, user: 'root@pam' }
      }
      return base(c, path, ...rest)
    })
    const d = await loadRunTaskDetail(conn, 'pve1', SCHED_UPID)
    expect(d.task).toMatchObject({ node: 'pve1', upid: SCHED_UPID, status: 'job errors', start: 1790256602, end: 1790256604 })
    expect(d.log.guests[0]).toMatchObject({ vmid: 9882, status: 'post_step_failed', step: 'prune', start: 1790256602 })
    expect(d.totalLines).toBe((pruneFailed as any[]).length)
  })

  it("converts the guest times with the node's own UTC offset (not the lock-wait heuristic)", async () => {
    const { loadRunTaskDetail } = await import('./vzdumpRunsService')
    const base = pveFetchMock.getMockImplementation()!
    const paths: string[] = []
    pveFetchMock.mockImplementation(async (c: any, path: string, ...rest: any[]) => {
      paths.push(path)
      if (path.endsWith('/status')) return { status: 'stopped', exitstatus: 'job errors', starttime: 1790256602, endtime: 1790256604 }
      // A node in UTC: the log's naive times are UTC already.
      if (path === '/nodes/pve1/time') return { time: 1790256700, localtime: 1790256700, timezone: 'UTC' }
      return base(c, path, ...rest)
    })
    const d = await loadRunTaskDetail(conn, 'pve1', SCHED_UPID)
    expect(paths).toContain('/nodes/pve1/time')
    // The fixture logs CEST (UTC+2): read as UTC, the guest starts 2 h "later".
    expect(d.log.guests[0].start).toBe(1790256602 + 7200)
  })

  it('falls back to the task-start heuristic when the node time cannot be read', async () => {
    const { loadRunTaskDetail } = await import('./vzdumpRunsService')
    const base = pveFetchMock.getMockImplementation()!
    pveFetchMock.mockImplementation(async (c: any, path: string, ...rest: any[]) => {
      if (path.endsWith('/status')) return { status: 'stopped', exitstatus: 'job errors', starttime: 1790256602, endtime: 1790256604 }
      if (path.endsWith('/time')) throw new Error('403 Permission check failed')
      return base(c, path, ...rest)
    })
    const d = await loadRunTaskDetail(conn, 'pve1', SCHED_UPID)
    expect(d.log.guests[0].start).toBe(1790256602)
  })
})
