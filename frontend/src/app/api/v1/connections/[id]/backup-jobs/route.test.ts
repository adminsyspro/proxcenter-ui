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
    BACKUP_JOB_CREATE: 'backup_job.create',
    BACKUP_JOB_VIEW: 'backup_job.view',
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

let createCalls: Array<{ body: string }>

function wirePveFetch() {
  pveFetchMock.mockImplementation(async (_conn: any, path: string, init?: any) => {
    if (path === '/cluster/backup' && init?.method === 'POST') {
      createCalls.push({ body: String(init?.body ?? '') })
      return { id: 'backup-42' }
    }
    throw new Error(`unexpected pveFetch path: ${path}`)
  })
}

async function create(body: Record<string, any>) {
  const { POST } = await import('./route')
  const res = await callRoute(POST as any, {
    params: { id: 'conn-1' },
    method: 'POST',
    body,
  })
  return { status: res.status, body: await readJson<any>(res) }
}

/** Parse the vzdump job payload the route sent to PVE. */
function sentParams(index = 0) {
  return new URLSearchParams(createCalls[index].body)
}

beforeEach(() => {
  createCalls = []
  pveFetchMock.mockReset()
  checkPermissionMock.mockReset().mockResolvedValue(null)
  getConnectionByIdMock.mockReset().mockResolvedValue({ id: 'conn-1', apiToken: 't' })
  getAllowedJobPoolsMock.mockReset().mockResolvedValue(null) // provider, not a vDC tenant
  maskingScopeMock.mockReset().mockReturnValue(null)
  wirePveFetch()
})

describe('POST /api/v1/connections/[id]/backup-jobs (#746 pool-based selection)', () => {
  it('sends pool= and neither all nor vmid for a pool selection', async () => {
    const { status } = await create({
      storage: 'PBS',
      schedule: '02:00',
      selectionMode: 'pool',
      pool: 'tenant-a',
      enabled: true,
    })

    expect(status).toBe(200)
    expect(createCalls).toHaveLength(1)

    const params = sentParams()
    expect(params.get('pool')).toBe('tenant-a')
    // PVE accepts exactly one selection: a pool job must not also carry all/vmid.
    expect(params.has('all')).toBe(false)
    expect(params.has('vmid')).toBe(false)
    expect(params.get('storage')).toBe('PBS')
  })

  it('ignores a stale vmids list when the mode is pool', async () => {
    // The create form keeps the previous selection in state when the user
    // switches mode, so the payload can still carry vmids.
    await create({
      storage: 'PBS',
      selectionMode: 'pool',
      pool: 'tenant-a',
      vmids: [101, 102],
      excludedVmids: [103],
    })

    const params = sentParams()
    expect(params.get('pool')).toBe('tenant-a')
    expect(params.has('vmid')).toBe(false)
    expect(params.has('exclude')).toBe(false)
  })

  it('returns 400 without creating anything when pool is missing', async () => {
    const { status, body } = await create({
      storage: 'PBS',
      selectionMode: 'pool',
    })

    expect(status).toBe(400)
    expect(body.error).toBe('Pool is required')
    expect(createCalls).toHaveLength(0)
  })

  it('returns 400 without creating anything when pool is an empty string', async () => {
    const { status, body } = await create({
      storage: 'PBS',
      selectionMode: 'pool',
      pool: '',
    })

    expect(status).toBe(400)
    expect(body.error).toBe('Pool is required')
    expect(createCalls).toHaveLength(0)
  })

  it('regression: selectionMode all still sends all=1 and no pool', async () => {
    const { status } = await create({
      storage: 'PBS',
      selectionMode: 'all',
      excludedVmids: [101, 102],
      pool: 'tenant-a', // leftover from a mode switch, must be ignored
    })

    expect(status).toBe(200)

    const params = sentParams()
    expect(params.get('all')).toBe('1')
    expect(params.get('exclude')).toBe('101,102')
    expect(params.has('pool')).toBe(false)
    expect(params.has('vmid')).toBe(false)
  })

  it('regression: selectionMode include still sends vmid and no pool', async () => {
    const { status } = await create({
      storage: 'PBS',
      selectionMode: 'include',
      vmids: [101, 102],
      pool: 'tenant-a', // leftover from a mode switch, must be ignored
    })

    expect(status).toBe(200)

    const params = sentParams()
    expect(params.get('vmid')).toBe('101,102')
    expect(params.has('pool')).toBe(false)
    expect(params.has('all')).toBe(false)
  })

  it('rejects the create when RBAC denies it', async () => {
    checkPermissionMock.mockResolvedValue(
      new Response(JSON.stringify({ error: 'denied' }), { status: 403 }),
    )
    const { status } = await create({ storage: 'PBS', selectionMode: 'pool', pool: 'tenant-a' })

    expect(status).toBe(403)
    expect(createCalls).toHaveLength(0)
  })
})
