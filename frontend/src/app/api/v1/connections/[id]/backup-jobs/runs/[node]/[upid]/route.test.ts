import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'
import { parseVzdumpCommandLine } from '@/lib/backups/vzdumpCommandLine'

const checkPermissionMock = vi.fn<(...args: any[]) => Promise<Response | null>>()
const loadRawMock = vi.fn<(...args: any[]) => Promise<any>>()
const detailMock = vi.fn<(...args: any[]) => Promise<any>>()
const allowedPoolsMock = vi.fn<(...args: any[]) => Promise<Set<string> | null>>()

vi.mock('@/lib/rbac', () => ({ checkPermission: checkPermissionMock, PERMISSIONS: { BACKUP_JOB_VIEW: 'backup_job.view' } }))
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionById: async (id: string) => ({ id }) }))
vi.mock('@/lib/tenant', () => ({ getCurrentTenantId: async () => 'tenant-x' }))
vi.mock('@/lib/vdc/backupJobs', () => ({
  getAllowedJobPools: allowedPoolsMock,
  // Real semantics needed here: vzdumpRunsTenant's filterBackupRunsForTenant
  // (kept real via the vzdumpRunsTenant mock below) imports this.
  isJobOwnedByTenantPools: (job: { pool?: string | null }, pools: Set<string>) => !!job.pool && pools.has(job.pool),
}))
vi.mock('@/lib/proxmox/client', () => ({ pveFetch: vi.fn() }))
vi.mock('@/lib/backups/vzdumpRunsService', async (orig) => ({
  ...(await orig<typeof import('@/lib/backups/vzdumpRunsService')>()),
  loadBackupRunsRaw: loadRawMock,
  loadRunTaskDetail: detailMock,
}))
vi.mock('@/lib/backups/vzdumpRunsTenant', async (orig) => ({
  ...(await orig<typeof import('@/lib/backups/vzdumpRunsTenant')>()),
  loadPoolByVmid: async () => new Map([[105, 'vdc-a']]),
}))

const MINE = 'UPID:pve1:0001:0002:6AB525DA:vzdump:105:root@pam!root:'
const FOREIGN = 'UPID:pve1:0003:0004:6AB525DB:vzdump:100:root@pam:'

const fact = (upid: string, vmids: number[], opts = '--node pve1 --storage local --mode stop') => ({
  task: { upid, node: 'pve1', starttime: 1, endtime: 2, status: 'OK' },
  invocation: parseVzdumpCommandLine(`INFO: starting new backup job: vzdump ${vmids.join(' ')} ${opts}`),
  log: null,
})

const raw = (facts: any[], jobs: any[] = []) => ({ jobs, facts, unreachableNodes: [], truncatedNodes: [], since: 0, days: 30 })

async function get(node: string, upid: string, searchParams?: Record<string, string>) {
  const { GET } = await import('./route')
  const res = await callRoute(GET as any, { params: { id: 'conn-1', node, upid: encodeURIComponent(upid) }, method: 'GET', searchParams })
  return { status: res.status, body: await readJson<any>(res) }
}

/** Like get(), but passes the upid param through as-is (no encodeURIComponent). */
async function getRaw(node: string, upid: string) {
  const { GET } = await import('./route')
  const res = await callRoute(GET as any, { params: { id: 'conn-1', node, upid }, method: 'GET' })
  return { status: res.status, body: await readJson<any>(res) }
}

beforeEach(() => {
  checkPermissionMock.mockReset().mockResolvedValue(null)
  allowedPoolsMock.mockReset().mockResolvedValue(null)
  detailMock.mockReset().mockResolvedValue({ task: { upid: MINE }, log: { guests: [] }, totalLines: 3 })
  // FOREIGN (vmid 100, infra) is a run of the provider's job; MINE (105) is manual.
  loadRawMock.mockReset().mockResolvedValue(raw([fact(FOREIGN, [100], '--node pve1 --storage pbs'), fact(MINE, [105])], [
    { id: 'other', type: 'vzdump', vmid: '100', storage: 'pbs' },
  ]))
})

describe('GET …/backup-jobs/runs/[node]/[upid]', () => {
  it('rejects a UPID that is not a vzdump task of that node', async () => {
    expect((await get('pve1', 'UPID:pve1:1:2:3:qmigrate:100:root@pam:')).status).toBe(400)
    expect((await get('pve2', MINE)).status).toBe(400)
  })

  it('gives the provider any vzdump task detail without computing runs', async () => {
    const { status, body } = await get('pve1', FOREIGN)
    expect(status).toBe(200)
    expect(body.data.totalLines).toBe(3)
    expect(loadRawMock).not.toHaveBeenCalled()
    expect(detailMock).toHaveBeenCalledWith({ id: 'conn-1' }, 'pve1', FOREIGN)
  })

  it('gives a vDC tenant its own manual run', async () => {
    allowedPoolsMock.mockResolvedValue(new Set(['vdc-a']))
    expect((await get('pve1', MINE)).status).toBe(200)
  })

  it("answers 404 to a vDC tenant asking for another tenant's task", async () => {
    allowedPoolsMock.mockResolvedValue(new Set(['vdc-a']))
    const { status } = await get('pve1', FOREIGN)
    expect(status).toBe(404)
    expect(detailMock).not.toHaveBeenCalled()
  })

  it("answers 404 when the UPID sits under the tenant's own job but backs up a foreign vmid", async () => {
    // #1003 review: jobMatches can attach a foreign-vmid task to a
    // tenant-owned job's run (same options / Run now replay). Job/pool
    // ownership alone must not be enough to serve it.
    allowedPoolsMock.mockResolvedValue(new Set(['vdc-a']))
    // A "Run now" replay (vmid list) of the tenant's pool job, backing up 100.
    loadRawMock.mockResolvedValue(raw([fact(FOREIGN, [100], '--node pve1 --storage pbs')], [
      { id: 'mine', type: 'vzdump', pool: 'vdc-a', storage: 'pbs' },
    ]))
    const { status } = await get('pve1', FOREIGN)
    expect(status).toBe(404)
    expect(detailMock).not.toHaveBeenCalled()
  })

  it('answers 400 on a malformed UPID escape sequence instead of 500', async () => {
    const { status } = await getRaw('pve1', '%E0')
    expect(status).toBe(400)
  })

  // #1003 final review (F2): the drawer passes its window; the route checks
  // visibility in that window first (same cache entry as the list), and only
  // scans the widest one when the task is not in it.
  it("checks a tenant's visibility in the drawer's window first", async () => {
    allowedPoolsMock.mockResolvedValue(new Set(['vdc-a']))
    expect((await get('pve1', MINE, { days: '7' })).status).toBe(200)
    expect(loadRawMock.mock.calls.map(c => c[2])).toEqual([{ days: 7 }])
  })

  it('falls back to the widest window when the task is not in the drawer’s', async () => {
    allowedPoolsMock.mockResolvedValue(new Set(['vdc-a']))
    loadRawMock.mockResolvedValueOnce(raw([])).mockResolvedValueOnce(raw([fact(MINE, [105])]))
    expect((await get('pve1', MINE, { days: '7' })).status).toBe(200)
    expect(loadRawMock.mock.calls.map(c => c[2])).toEqual([{ days: 7 }, { days: 90 }])
  })

  it('does not rescan when the drawer already shows the widest window', async () => {
    allowedPoolsMock.mockResolvedValue(new Set(['vdc-a']))
    loadRawMock.mockResolvedValue(raw([]))
    expect((await get('pve1', MINE, { days: '90' })).status).toBe(404)
    expect(loadRawMock).toHaveBeenCalledTimes(1)
  })

  // #1003 residual R2: the served log is checked too, not only the history.
  const liveDetail = (status: string, commandLine: string, vmids: number[]) => ({
    task: { node: 'pve1', upid: MINE, status },
    log: { commandLine: `INFO: starting new backup job: vzdump ${commandLine}`, guests: vmids.map(vmid => ({ vmid })), jobLines: [] },
    totalLines: 3,
  })

  it('answers 404 to a tenant when the served log holds a foreign guest', async () => {
    allowedPoolsMock.mockResolvedValue(new Set(['vdc-a']))
    detailMock.mockResolvedValue(liveDetail('OK', '105 --storage local', [105, 100]))
    expect((await get('pve1', MINE)).status).toBe(404)
  })

  it('answers 404 to a tenant for a running --all task even if its first guest is theirs', async () => {
    allowedPoolsMock.mockResolvedValue(new Set(['vdc-a']))
    detailMock.mockResolvedValue(liveDetail('running', '--all 1 --storage local', [105]))
    expect((await get('pve1', MINE)).status).toBe(404)
  })

  it('serves a tenant the live log of its own running pool task', async () => {
    allowedPoolsMock.mockResolvedValue(new Set(['vdc-a']))
    detailMock.mockResolvedValue(liveDetail('running', '--pool vdc-a --storage local', [105]))
    expect((await get('pve1', MINE)).status).toBe(200)
  })

  it('never applies the tenant check to the provider', async () => {
    detailMock.mockResolvedValue(liveDetail('running', '--all 1 --storage local', [105, 100]))
    expect((await get('pve1', MINE)).status).toBe(200)
  })
})
