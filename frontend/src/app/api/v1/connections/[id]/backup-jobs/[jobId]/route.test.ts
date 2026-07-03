import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

const checkPermissionMock = vi.fn<(...args: any[]) => Promise<Response | null>>()
const pveFetchMock = vi.fn<(...args: any[]) => Promise<any>>()
const getConnectionByIdMock = vi.fn<(id: string) => Promise<any>>()
const getAllowedJobPoolsMock = vi.fn<(...args: any[]) => Promise<any>>()
const maskingScopeMock = vi.fn<(...args: any[]) => any>()

vi.mock('@/lib/proxmox/client', () => ({ pveFetch: pveFetchMock }))
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionById: getConnectionByIdMock }))
vi.mock('@/lib/rbac', () => ({
  checkPermission: checkPermissionMock,
  PERMISSIONS: {
    BACKUP_JOB_RUN: 'backup_job.run',
    BACKUP_JOB_VIEW: 'backup_job.view',
    BACKUP_JOB_EDIT: 'backup_job.edit',
    BACKUP_JOB_DELETE: 'backup_job.delete',
  },
}))
vi.mock('@/lib/tenant', () => ({ getCurrentTenantId: async () => 'default' }))
vi.mock('@/lib/tenant/infraScope', () => ({
  getTenantInfrastructureScope: async () => null,
  maskingScope: maskingScopeMock,
}))
vi.mock('@/lib/vdc/backupJobs', () => ({
  getAllowedJobPools: getAllowedJobPoolsMock,
  isJobOwnedByTenantPools: () => true,
  validateTenantJobBody: () => null,
  validateTenantJobInfra: () => null,
}))

// Cluster: VM 105 lives on pve-r730-01; nodes[0] is the alphabetically-first
// pve-r240 (the node the old code wrongly picked).
const NODES = [
  { node: 'pve-r240', status: 'online' },
  { node: 'pve-r730-01', status: 'online' },
  { node: 'pve-r730-02', status: 'online' },
]
const RESOURCES = [
  { vmid: 105, node: 'pve-r730-01', status: 'running', type: 'qemu' },
  { vmid: 200, node: 'pve-r240', status: 'running', type: 'qemu' },
]

let vzdumpCalls: Array<{ node: string; body: string }>
let job: Record<string, any>

function wirePveFetch() {
  pveFetchMock.mockImplementation(async (_conn: any, path: string, init?: any) => {
    if (path.startsWith('/cluster/backup/')) return job
    if (path === '/nodes') return NODES
    if (path.startsWith('/cluster/resources')) return RESOURCES
    if (path.startsWith('/nodes/') && path.endsWith('/vzdump')) {
      const node = path.split('/')[2]
      vzdumpCalls.push({ node, body: String(init?.body ?? '') })
      return `UPID:${node}:0000`
    }
    throw new Error(`unexpected pveFetch path: ${path}`)
  })
}

async function run(jobId = 'backup-1') {
  const { POST } = await import('./route')
  const res = await callRoute(POST as any, {
    params: { id: 'conn-1', jobId },
    searchParams: { action: 'run' },
    method: 'POST',
  })
  return { status: res.status, body: await readJson<any>(res) }
}

beforeEach(() => {
  vzdumpCalls = []
  pveFetchMock.mockReset()
  checkPermissionMock.mockReset().mockResolvedValue(null)
  getConnectionByIdMock.mockReset().mockResolvedValue({ id: 'conn-1', apiToken: 't' })
  getAllowedJobPoolsMock.mockReset().mockResolvedValue(null) // provider (full view)
  maskingScopeMock.mockReset().mockReturnValue(null)
  job = { id: 'backup-1', storage: 'PBS', vmid: '105', mode: 'snapshot', compress: 'zstd' }
  wirePveFetch()
})

describe('POST /api/v1/connections/[id]/backup-jobs/[jobId]?action=run', () => {
  it('#537: dispatches vzdump to the node hosting the selected VM, not nodes[0]', async () => {
    const { status, body } = await run()

    expect(status).toBe(200)
    expect(vzdumpCalls).toHaveLength(1)
    expect(vzdumpCalls[0].node).toBe('pve-r730-01') // NOT pve-r240
    expect(vzdumpCalls[0].body).toContain('vmid=105')
    expect(vzdumpCalls[0].body).toContain('storage=PBS')
    expect(body.data.tasks).toHaveLength(1)
    expect(body.message).toContain('1 node')
  })

  it('replays the job retention/options on the run', async () => {
    job['prune-backups'] = 'keep-last=3'
    const { body } = await run()
    expect(vzdumpCalls[0].body).toContain('prune-backups=keep-last')
    expect(body.data.tasks[0].node).toBe('pve-r730-01')
  })

  it('returns 400 when the selected guest is not on any online node', async () => {
    job.vmid = '999' // unknown vmid
    const { status, body } = await run()
    expect(status).toBe(400)
    expect(vzdumpCalls).toHaveLength(0)
    expect(body.error).toMatch(/not on an online node/i)
  })

  it('honours a pinned node without a resource lookup', async () => {
    job = { id: 'backup-1', storage: 'PBS', vmid: '105', node: 'pve-r240' }
    const { status } = await run()
    expect(status).toBe(200)
    expect(vzdumpCalls[0].node).toBe('pve-r240')
    // pinned path must not query /cluster/resources
    expect(pveFetchMock.mock.calls.some((c) => String(c[1]).startsWith('/cluster/resources'))).toBe(false)
  })

  it('rejects the run when RBAC denies it', async () => {
    checkPermissionMock.mockResolvedValue(
      new Response(JSON.stringify({ error: 'denied' }), { status: 403 }),
    )
    const { status } = await run()
    expect(status).toBe(403)
    expect(vzdumpCalls).toHaveLength(0)
  })
})
