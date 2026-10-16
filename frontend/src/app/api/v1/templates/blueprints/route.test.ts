import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

const m = vi.hoisted(() => ({
  checkPermission: vi.fn<(...a: any[]) => Promise<any>>(),
  getCurrentTenantId: vi.fn<() => Promise<string>>(),
  create: vi.fn<(...a: any[]) => Promise<any>>(),
  listVisibleBlueprints: vi.fn<(...a: any[]) => Promise<any[]>>(),
  loadGrantSummaries: vi.fn<(...a: any[]) => Promise<Map<string, any>>>(),
  replaceTenantGrants: vi.fn<(...a: any[]) => Promise<void>>(),
  audit: vi.fn<(...a: any[]) => Promise<void>>(),
}))

vi.mock('@/lib/rbac', () => ({ checkPermission: m.checkPermission, PERMISSIONS: { VM_VIEW: 'vm.view', VM_CREATE: 'vm.create' } }))
vi.mock('@/lib/tenant', () => ({
  getSessionPrisma: async () => ({ blueprint: { create: m.create } }),
  getCurrentTenantId: m.getCurrentTenantId,
  DEFAULT_TENANT_ID: 'default',
}))
vi.mock('next-auth', () => ({ getServerSession: async () => ({ user: { id: 'u1' } }) }))
vi.mock('@/lib/auth/config', () => ({ authOptions: {} }))
vi.mock('@/lib/audit', () => ({ audit: m.audit }))
vi.mock('@/lib/templates/catalogGrants', () => ({
  listVisibleBlueprints: m.listVisibleBlueprints,
  loadGrantSummaries: m.loadGrantSummaries,
  replaceTenantGrants: m.replaceTenantGrants,
}))

import { GET, POST } from './route'

const body = {
  name: 'Golden web',
  imageSlug: 'custom-golden',
  hardware: { cores: 1, sockets: 1, memory: 1024, diskSize: '10G', scsihw: 'virtio-scsi-single', networkModel: 'virtio', networkBridge: 'vmbr0', ostype: 'l26', agent: true, cpu: 'host' },
}

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset()
  m.checkPermission.mockResolvedValue(null)
  m.getCurrentTenantId.mockResolvedValue('tenant-1')
  m.create.mockImplementation(async ({ data }) => ({ id: 'bp-1', ...data }))
  m.listVisibleBlueprints.mockResolvedValue([])
  m.loadGrantSummaries.mockResolvedValue(new Map())
  m.replaceTenantGrants.mockResolvedValue()
  m.audit.mockResolvedValue()
})

describe('GET /api/v1/templates/blueprints (#903)', () => {
  it('lists the visible scope and marks the rows the caller does not own', async () => {
    m.listVisibleBlueprints.mockResolvedValue([
      { id: 'own', tenantId: 'tenant-1', name: 'mine' },
      { id: 'prov', tenantId: 'default', name: 'provider recipe', isShared: false },
    ])
    const res = await callRoute(GET as any, { method: 'GET' })
    const json = await readJson<any>(res)
    expect(m.listVisibleBlueprints).toHaveBeenCalledWith('tenant-1')
    expect(json.data.map((b: any) => [b.id, b.ownedByCaller])).toEqual([['own', true], ['prov', false]])
    expect(json.data[1].grants).toBeUndefined()
    expect(m.loadGrantSummaries).not.toHaveBeenCalled()
  })

  it('gives the provider the grant summary of each row', async () => {
    m.getCurrentTenantId.mockResolvedValue('default')
    m.listVisibleBlueprints.mockResolvedValue([{ id: 'prov', tenantId: 'default', name: 'r' }])
    m.loadGrantSummaries.mockResolvedValue(new Map([['prov', { tenantIds: ['tenant-1'], vdcIds: [] }]]))
    const json = await readJson<any>(await callRoute(GET as any, { method: 'GET' }))
    expect(json.data[0]).toMatchObject({ ownedByCaller: true, grants: { tenantIds: ['tenant-1'], vdcIds: [] } })
    expect(m.loadGrantSummaries).toHaveBeenCalledWith('blueprint', ['prov'])
  })
})

describe('POST /api/v1/templates/blueprints (#903)', () => {
  it('a tenant cannot share or grant its blueprint', async () => {
    const res = await callRoute(POST as any, { body: { ...body, isShared: true, grantTenantIds: ['tenant-2'] } })
    expect(res.status).toBe(201)
    expect(m.create.mock.calls[0][0].data.isShared).toBe(false)
    expect(m.replaceTenantGrants).not.toHaveBeenCalled()
  })

  it('the provider can share with everyone or grant to listed tenants', async () => {
    m.getCurrentTenantId.mockResolvedValue('default')
    let res = await callRoute(POST as any, { body: { ...body, isShared: true } })
    expect(res.status).toBe(201)
    expect(m.create.mock.calls[0][0].data.isShared).toBe(true)

    res = await callRoute(POST as any, { body: { ...body, grantTenantIds: ['tenant-1', 'tenant-2'] } })
    expect(res.status).toBe(201)
    expect(m.create.mock.calls[1][0].data.isShared).toBe(false)
    expect(m.replaceTenantGrants).toHaveBeenCalledWith('blueprint', 'bp-1', ['tenant-1', 'tenant-2'], 'u1')
  })

  it('returns the permission denial untouched', async () => {
    m.checkPermission.mockResolvedValue(Response.json({ error: 'nope' }, { status: 403 }))
    const res = await callRoute(POST as any, { body })
    expect(res.status).toBe(403)
    expect(m.create).not.toHaveBeenCalled()
  })
})
