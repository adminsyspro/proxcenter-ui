import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

const checkPermissionMock = vi.fn<(...args: any[]) => Promise<Response | null>>()
const pveFetchMock = vi.fn<(...args: any[]) => Promise<any>>()
const getConnectionByIdMock = vi.fn<(id: string) => Promise<any>>()
const getAllowedJobPoolsMock = vi.fn<(...args: any[]) => Promise<any>>()
const maskingScopeMock = vi.fn<(...args: any[]) => any>()
const perimeterMock = vi.fn<(...args: any[]) => Promise<any>>()

vi.mock('@/lib/proxmox/client', () => ({ pveFetch: pveFetchMock }))
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionById: getConnectionByIdMock }))
vi.mock('@/lib/rbac', () => ({
  // Storage-scope helpers (#921): the id builder is the real shape, the
  // perimeter is unrestricted unless a test overrides it.
  buildStorageResourceId: (id: string, storage: string) => `${id}:${storage}`,
  getRequestStorageGrantPerimeter: (...a: any[]) => perimeterMock(...a),
  filterStoragesByGrant: (items: any[], p: any, of: (i: any) => string) => (p?.restricted ? items.filter((i: any) => p.storages.has(of(i))) : items),
  checkPermission: checkPermissionMock,
  PERMISSIONS: {
    BACKUP_JOB_CREATE: 'backup_job.create',
    BACKUP_JOB_VIEW: 'backup_job.view',
    BACKUP_JOB_EDIT: 'backup_job.edit',
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
  perimeterMock.mockReset().mockResolvedValue(null)
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

describe('storage scope on backup jobs (#921)', () => {
  it('judges backup.job.create on the destination storage, and on the fleecing storage too', async () => {
    await create({ storage: 'PBS', selectionMode: 'pool', pool: 'p', fleecing: true, fleecingStorage: 'local' })
    expect(checkPermissionMock).toHaveBeenCalledWith('backup_job.create', 'storage', 'conn-1:PBS')
    expect(checkPermissionMock).toHaveBeenCalledWith('backup_job.create', 'storage', 'conn-1:local')
    expect(createCalls).toHaveLength(1)
  })

  it('refuses a destination the caller is not granted before anything reaches PVE', async () => {
    checkPermissionMock.mockImplementation(async (_p: string, type: string, id: string) =>
      type === 'storage' && id === 'conn-1:PBS' ? null : Response.json({ error: 'Permission denied: backup.job.create' }, { status: 403 }))
    expect((await create({ storage: 'local', selectionMode: 'pool', pool: 'p' })).status).toBe(403)
    expect((await create({ storage: 'PBS', selectionMode: 'pool', pool: 'p', fleecing: true, fleecingStorage: 'local' })).status).toBe(403)
    expect(createCalls).toHaveLength(0)
    expect((await create({ storage: 'PBS', selectionMode: 'pool', pool: 'p' })).status).toBe(200)
  })

  it('falls back to the connection check when the body names no storage, so the 400 still reaches an authorised caller', async () => {
    const { status, body } = await create({ selectionMode: 'pool', pool: 'p' })
    expect(checkPermissionMock).toHaveBeenCalledWith('backup_job.create', 'connection', 'conn-1')
    expect(status).toBe(400)
    expect(body.error).toBe('Storage is required')
  })

  describe('GET', () => {
    const JOBS = [{ id: 'j-pbs', storage: 'PBS' }, { id: 'j-local', storage: 'local' }]
    const STORAGES = [
      { storage: 'PBS', type: 'pbs', content: 'backup' },
      { storage: 'local', type: 'dir', content: 'backup,iso' },
    ]
    async function list() {
      pveFetchMock.mockImplementation(async (_conn: any, path: string) => {
        if (path === '/cluster/backup') return JOBS
        if (path === '/storage') return STORAGES
        if (path === '/nodes') return [{ node: 'pve1', status: 'online' }]
        if (path === '/nodes/pve1/storage') return []
        throw new Error('unexpected ' + path)
      })
      const { GET } = await import('./route')
      const res = await callRoute(GET as any, { params: { id: 'conn-1' }, method: 'GET' })
      return { status: res.status, body: await readJson<any>(res) }
    }

    it('lets a caller granted backup.job.view on some storages in and narrows the jobs to them', async () => {
      checkPermissionMock.mockResolvedValue(Response.json({ error: 'denied' }, { status: 403 }))
      perimeterMock.mockImplementation(async (_id: string, perm: string) =>
        perm === 'backup_job.view' ? { restricted: true, storages: new Set(['PBS']) } : { restricted: true, storages: new Set() })
      const { status, body } = await list()
      expect(status).toBe(200)
      expect(body.data.jobs.map((j: any) => j.id)).toEqual(['j-pbs'])
      // No create or edit grant anywhere: nothing to offer as a destination.
      expect(body.data.storages).toEqual([])
    })

    it('keeps the denial when no storage of the connection is granted', async () => {
      checkPermissionMock.mockResolvedValue(Response.json({ error: 'denied' }, { status: 403 }))
      perimeterMock.mockResolvedValue({ restricted: true, storages: new Set() })
      expect((await list()).status).toBe(403)
      expect(pveFetchMock).not.toHaveBeenCalled()
    })

    it('offers only the destinations the caller may create or edit a job on', async () => {
      perimeterMock.mockImplementation(async (_id: string, perm: string) =>
        perm === 'backup_job.create' ? { restricted: true, storages: new Set(['PBS']) } : { restricted: true, storages: new Set() })
      const { body } = await list()
      expect(body.data.jobs).toHaveLength(2)
      expect(body.data.storages.map((s: any) => s.id)).toEqual(['PBS'])
      expect(body.data.allBackupStorages.map((s: any) => s.id)).toEqual(['PBS'])
    })

    it('an unrestricted caller keeps the whole picture', async () => {
      const { body } = await list()
      expect(body.data.jobs).toHaveLength(2)
      expect(body.data.storages.map((s: any) => s.id)).toEqual(['PBS', 'local'])
    })
  })
})
