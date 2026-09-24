import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

const checkPermissionMock = vi.fn<(...args: any[]) => Promise<Response | null>>()
const collectMock = vi.fn<(...args: any[]) => Promise<any>>()
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
vi.mock('@/lib/backups/vzdumpRunsService', () => ({
  collectBackupRuns: collectMock,
  loadRunTaskDetail: detailMock,
  MAX_DAYS: 90,
}))
vi.mock('@/lib/backups/vzdumpRunsTenant', async (orig) => ({
  ...(await orig<typeof import('@/lib/backups/vzdumpRunsTenant')>()),
  loadPoolByVmid: async () => new Map([[105, 'vdc-a']]),
}))

const MINE = 'UPID:pve1:0001:0002:6AB525DA:vzdump:105:root@pam!root:'
const FOREIGN = 'UPID:pve1:0003:0004:6AB525DB:vzdump:100:root@pam:'

const run = (upid: string, vmids: number[]) => ({
  id: upid, start: 1, end: 2, durationSec: 1, origin: 'manual', status: 'ok', statusDetail: { failed: 0, total: 1 },
  tasks: [{ node: 'pve1', upid, status: 'OK', start: 1, end: 2, vmids, logUnavailable: false }],
})

async function get(node: string, upid: string) {
  const { GET } = await import('./route')
  const res = await callRoute(GET as any, { params: { id: 'conn-1', node, upid: encodeURIComponent(upid) }, method: 'GET' })
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
  collectMock.mockReset().mockResolvedValue({
    jobs: [{ jobId: 'other', pool: 'infra', nextRun: null, lastRun: null, runs: [run(FOREIGN, [100])] }],
    manual: { lastRun: null, runs: [run(MINE, [105])] },
    unreachableNodes: [],
    window: { since: 0, days: 30 },
  })
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
    expect(collectMock).not.toHaveBeenCalled()
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
    collectMock.mockResolvedValue({
      jobs: [{ jobId: 'mine', pool: 'vdc-a', nextRun: null, lastRun: null, runs: [run(FOREIGN, [100])] }],
      manual: { lastRun: null, runs: [] },
      unreachableNodes: [],
      window: { since: 0, days: 30 },
    })
    const { status } = await get('pve1', FOREIGN)
    expect(status).toBe(404)
    expect(detailMock).not.toHaveBeenCalled()
  })

  it('answers 400 on a malformed UPID escape sequence instead of 500', async () => {
    const { status } = await getRaw('pve1', '%E0')
    expect(status).toBe(400)
  })
})
