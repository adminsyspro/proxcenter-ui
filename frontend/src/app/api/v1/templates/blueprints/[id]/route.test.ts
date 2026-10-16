import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

const m = vi.hoisted(() => ({
  checkPermission: vi.fn<(...a: any[]) => Promise<any>>(),
  getCurrentTenantId: vi.fn<() => Promise<string>>(),
  update: vi.fn<(...a: any[]) => Promise<any>>(),
  findUnique: vi.fn<(...a: any[]) => Promise<any>>(),
  remove: vi.fn<(...a: any[]) => Promise<any>>(),
  findBlueprintForTenant: vi.fn<(...a: any[]) => Promise<any>>(),
  loadGrantSummary: vi.fn<(...a: any[]) => Promise<any>>(),
  replaceTenantGrants: vi.fn<(...a: any[]) => Promise<void>>(),
  audit: vi.fn<(...a: any[]) => Promise<void>>(),
}))

vi.mock('@/lib/rbac', () => ({ checkPermission: m.checkPermission, PERMISSIONS: { VM_VIEW: 'vm.view', VM_CREATE: 'vm.create' } }))
vi.mock('@/lib/tenant', () => ({
  getSessionPrisma: async () => ({ blueprint: { update: m.update, findUnique: m.findUnique, delete: m.remove } }),
  getCurrentTenantId: m.getCurrentTenantId,
  DEFAULT_TENANT_ID: 'default',
}))
vi.mock('@/lib/audit', () => ({ audit: m.audit }))
vi.mock('@/lib/templates/catalogGrants', () => ({
  findBlueprintForTenant: m.findBlueprintForTenant,
  loadGrantSummary: m.loadGrantSummary,
  replaceTenantGrants: m.replaceTenantGrants,
}))

import { DELETE, GET, PUT } from './route'

const params = { id: 'bp-1' }
const body = {
  name: 'Golden web',
  imageSlug: 'custom-golden',
  hardware: { cores: 1, sockets: 1, memory: 1024, diskSize: '10G', scsihw: 'virtio-scsi-single', networkModel: 'virtio', networkBridge: 'vmbr0', ostype: 'l26', agent: true, cpu: 'host' },
}
const notFound = () => Object.assign(new Error('Record not found'), {})

beforeEach(() => {
  for (const fn of Object.values(m)) fn.mockReset()
  m.checkPermission.mockResolvedValue(null)
  m.getCurrentTenantId.mockResolvedValue('tenant-1')
  m.update.mockImplementation(async ({ where, data }) => ({ id: where.id, ...data }))
  m.findUnique.mockResolvedValue({ name: 'Golden web' })
  m.remove.mockResolvedValue({})
  m.loadGrantSummary.mockResolvedValue({ tenantIds: ['tenant-1'], vdcIds: [] })
  m.replaceTenantGrants.mockResolvedValue()
  m.audit.mockResolvedValue()
})

describe('GET /api/v1/templates/blueprints/[id] (#903)', () => {
  it('answers a blueprint the tenant only sees through a grant, marked as not its own and without grants', async () => {
    m.findBlueprintForTenant.mockResolvedValue({ id: 'bp-1', tenantId: 'default', name: 'provider recipe' })
    const json = await readJson<any>(await callRoute(GET as any, { method: 'GET', params }))
    expect(m.findBlueprintForTenant).toHaveBeenCalledWith('tenant-1', 'bp-1')
    expect(json.data).toMatchObject({ id: 'bp-1', ownedByCaller: false })
    expect(json.data.grants).toBeUndefined()
    expect(m.loadGrantSummary).not.toHaveBeenCalled()
  })

  it('gives the provider its own blueprint with the grant summary', async () => {
    m.getCurrentTenantId.mockResolvedValue('default')
    m.findBlueprintForTenant.mockResolvedValue({ id: 'bp-1', tenantId: 'default', name: 'r' })
    const json = await readJson<any>(await callRoute(GET as any, { method: 'GET', params }))
    expect(json.data).toMatchObject({ ownedByCaller: true, grants: { tenantIds: ['tenant-1'], vdcIds: [] } })
    expect(m.loadGrantSummary).toHaveBeenCalledWith('blueprint', 'bp-1')
  })

  it('answers 404 outside the visible scope', async () => {
    m.findBlueprintForTenant.mockResolvedValue(null)
    const res = await callRoute(GET as any, { method: 'GET', params })
    expect(res.status).toBe(404)
  })
})

describe('PUT /api/v1/templates/blueprints/[id] (#903)', () => {
  it('lets the provider set the visibility and the tenant grants', async () => {
    m.getCurrentTenantId.mockResolvedValue('default')
    const res = await callRoute(PUT as any, { method: 'PUT', params, body: { ...body, isShared: false, grantTenantIds: ['tenant-1'] } })
    expect(res.status).toBe(200)
    expect(m.update.mock.calls[0][0].data.isShared).toBe(false)
    expect(m.replaceTenantGrants).toHaveBeenCalledWith('blueprint', 'bp-1', ['tenant-1'], null)
  })

  it('ignores visibility and grants sent by a tenant', async () => {
    const res = await callRoute(PUT as any, { method: 'PUT', params, body: { ...body, isShared: true, grantTenantIds: ['tenant-2'] } })
    expect(res.status).toBe(200)
    expect(m.update.mock.calls[0][0].data).not.toHaveProperty('isShared')
    expect(m.replaceTenantGrants).not.toHaveBeenCalled()
  })

  it('answers 404, not 500, when the scoped client refuses a blueprint the tenant does not own', async () => {
    m.update.mockRejectedValue(notFound())
    const res = await callRoute(PUT as any, { method: 'PUT', params, body })
    expect(res.status).toBe(404)
  })
})

describe('DELETE /api/v1/templates/blueprints/[id] (#903)', () => {
  it('answers 404, not 500, on a blueprint the tenant does not own', async () => {
    m.remove.mockRejectedValue(notFound())
    const res = await callRoute(DELETE as any, { method: 'DELETE', params })
    expect(res.status).toBe(404)
  })

  it('deletes an own blueprint', async () => {
    const res = await callRoute(DELETE as any, { method: 'DELETE', params })
    expect(res.status).toBe(200)
    expect(m.remove).toHaveBeenCalledWith({ where: { id: 'bp-1' } })
  })
})
