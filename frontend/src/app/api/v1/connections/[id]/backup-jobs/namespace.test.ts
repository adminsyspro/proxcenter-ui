import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

// The PBS namespace is a property of the PBS storage (storage.cfg), not of the
// vzdump job: PVE refuses `ns` inside prune-backups (400 "prune-backups.ns:
// property is not defined in schema"). Create, update and list must all go
// through the storage.

const pveFetchMock = vi.fn<(...args: any[]) => Promise<any>>()

vi.mock('@/lib/proxmox/client', () => ({ pveFetch: pveFetchMock }))
vi.mock('@/lib/backups/vzdumpRunsService', () => ({ invalidateBackupRuns: vi.fn() }))
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionById: async () => ({ id: 'conn-1', apiToken: 't' }) }))
vi.mock('@/lib/rbac', () => ({
  checkPermission: async () => null,
  PERMISSIONS: { BACKUP_JOB_CREATE: 'c', BACKUP_JOB_VIEW: 'v', BACKUP_JOB_EDIT: 'e', BACKUP_JOB_DELETE: 'd', BACKUP_JOB_RUN: 'r' },
}))
vi.mock('@/lib/tenant', () => ({ getCurrentTenantId: async () => 'default' }))
vi.mock('@/lib/tenant/infraScope', () => ({ getTenantInfrastructureScope: async () => null, maskingScope: () => null }))
vi.mock('@/lib/vdc/backupJobs', () => ({
  getAllowedJobPools: async () => null,
  isJobOwnedByTenantPools: () => true,
  validateTenantJobBody: () => null,
  validateTenantJobInfra: () => null,
}))
vi.mock('@/lib/vdc/scope', () => ({ writableStoragesFor: () => new Set() }))

const STORAGES = [
  { storage: 'pbs-root', type: 'pbs', content: 'backup', datastore: 'ds1' },
  { storage: 'pbs-prod', type: 'pbs', content: 'backup', datastore: 'ds1', namespace: 'prod/web' },
  { storage: 'local', type: 'dir', content: 'backup,iso' },
]

let writes: Array<{ method: string; path: string; body: URLSearchParams }>

beforeEach(() => {
  writes = []
  pveFetchMock.mockReset().mockImplementation(async (_c: any, path: string, init?: any) => {
    if (init?.method === 'POST' || init?.method === 'PUT') {
      writes.push({ method: init.method, path, body: new URLSearchParams(String(init.body ?? '')) })
      return null
    }
    if (path === '/storage') return STORAGES
    if (path.startsWith('/storage/')) return STORAGES.find(s => s.storage === decodeURIComponent(path.slice(9)))
    if (path === '/cluster/backup') return [
      { id: 'j-prod', storage: 'pbs-prod', all: 1, 'prune-backups': 'keep-last=3' },
      { id: 'j-root', storage: 'pbs-root', vmid: '100', 'prune-backups': 'keep-last=2,ns=legacy' },
    ]
    if (path.startsWith('/cluster/backup/')) return { id: 'j-prod', storage: 'pbs-prod', all: 1 }
    if (path === '/nodes') return [{ node: 'pve1', status: 'online' }]
    if (path.startsWith('/nodes/')) return []
    throw new Error(`unexpected ${path}`)
  })
})

async function create(body: Record<string, any>) {
  const { POST } = await import('./route')
  const res = await callRoute(POST as any, { params: { id: 'conn-1' }, method: 'POST', body })
  return { status: res.status, body: await readJson<any>(res) }
}

async function update(body: Record<string, any>) {
  const { PUT } = await import('./[jobId]/route')
  const res = await callRoute(PUT as any, { params: { id: 'conn-1', jobId: 'j-prod' }, method: 'PUT', body })
  return { status: res.status, body: await readJson<any>(res) }
}

const base = { schedule: '02:00', selectionMode: 'include', vmids: ['9201'], enabled: true, keepLast: 3 }

describe('PBS namespace of backup jobs', () => {
  it('create: never sends ns inside prune-backups, whatever the body says', async () => {
    const { status } = await create({ ...base, storage: 'pbs-prod', namespace: 'prod/web' })
    expect(status).toBe(200)
    const sent = writes[0].body
    expect(sent.get('prune-backups')).toBe('keep-last=3')
    expect(sent.toString()).not.toContain('ns%3D')
    expect(sent.has('namespace')).toBe(false)
  })

  it('create: an empty namespace is ignored without reading the storage', async () => {
    const { status } = await create({ ...base, storage: 'pbs-root', namespace: '' })
    expect(status).toBe(200)
    expect(pveFetchMock.mock.calls.some(c => String(c[1]).startsWith('/storage/'))).toBe(false)
  })

  it('create: a namespace the storage does not carry is a 400 with a code, and nothing is created', async () => {
    const { status, body } = await create({ ...base, storage: 'pbs-root', namespace: 'prod/web' })
    expect(status).toBe(400)
    expect(body).toMatchObject({ code: 'namespace_storage_mismatch', storage: 'pbs-root', storageNamespace: '', namespace: 'prod/web' })
    expect(writes).toHaveLength(0)
  })

  it('update: never sends ns, and refuses a namespace foreign to the job storage', async () => {
    expect((await update({ keepLast: 5, namespace: '/prod/web/' })).status).toBe(200)
    expect(writes[0].body.get('prune-backups')).toBe('keep-last=5')
    expect(writes[0].body.toString()).not.toContain('ns%3D')

    writes = []
    const { status, body } = await update({ keepLast: 5, namespace: 'other' })
    expect(status).toBe(400)
    expect(body.code).toBe('namespace_storage_mismatch')
    expect(writes).toHaveLength(0)
  })

  it('list: the namespace column is the namespace of the job storage, not a ns= read from prune-backups', async () => {
    const { GET } = await import('./route')
    const res = await callRoute(GET as any, { params: { id: 'conn-1' } })
    const body = await readJson<any>(res)
    const byId = Object.fromEntries(body.data.jobs.map((j: any) => [j.id, j.namespace]))
    expect(byId).toEqual({ 'j-prod': 'prod/web', 'j-root': '' })
    expect(body.data.allBackupStorages.find((s: any) => s.id === 'pbs-prod')).toMatchObject({ namespace: 'prod/web', datastore: 'ds1' })
  })
})
