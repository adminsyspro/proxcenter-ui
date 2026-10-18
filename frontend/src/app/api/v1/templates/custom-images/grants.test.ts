/**
 * Provider grants on custom images (#903): the provider reads and writes the
 * per-tenant grants of its images, a tenant never sees nor sets them.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

const m = vi.hoisted(() => ({
  tenant: vi.fn(), permission: vi.fn(),
  findMany: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(),
  loadGrantSummaries: vi.fn(), loadGrantSummary: vi.fn(), replaceTenantGrants: vi.fn(),
}))
vi.mock('@/lib/tenant', () => ({
  DEFAULT_TENANT_ID: 'default', getCurrentTenantId: m.tenant,
  getSessionPrisma: async () => ({ customImage: { findMany: m.findMany, findUnique: m.findUnique, create: m.create, update: m.update } }),
}))
vi.mock('@/lib/rbac', () => ({ checkPermission: m.permission, PERMISSIONS: { VM_VIEW: 'vm.view', VM_CREATE: 'vm.create' } }))
vi.mock('next-auth', () => ({ getServerSession: async () => ({ user: { id: 'user-p' } }) }))
vi.mock('@/lib/auth/config', () => ({ authOptions: {} }))
vi.mock('@/lib/db/prisma', () => ({ prisma: { customImage: { findUnique: async () => null, findFirst: async () => null }, tenant: { findUnique: async () => ({ slug: 'provider' }) } } }))
vi.mock('@/lib/audit', () => ({ audit: async () => {} }))
vi.mock('@/lib/templates/catalogGrants', () => ({
  loadGrantSummaries: m.loadGrantSummaries, loadGrantSummary: m.loadGrantSummary, replaceTenantGrants: m.replaceTenantGrants,
}))

import { GET as LIST, POST } from './route'
import { GET as GET_ONE, PUT } from './[id]/route'

const urlImage = { name: 'Debian golden', sourceType: 'url', downloadUrl: 'https://example.com/debian.qcow2' }
const params = { id: 'img-1' }

beforeEach(() => {
  vi.clearAllMocks()
  m.tenant.mockResolvedValue('default')
  m.permission.mockResolvedValue(null)
  m.findMany.mockResolvedValue([{ id: 'img-1', name: 'a' }, { id: 'img-2', name: 'b' }])
  // findUnique answers by id only: the POST slug lookup (tenantId_slug) finds nothing.
  m.findUnique.mockImplementation(async ({ where }) => (where?.id === 'img-1' ? { id: 'img-1', name: 'a', sourceType: 'url', downloadUrl: urlImage.downloadUrl } : null))
  m.create.mockImplementation(async ({ data }) => ({ id: 'img-new', ...data }))
  m.update.mockImplementation(async ({ where, data }) => ({ id: where.id, name: 'a', slug: 'a', ...data }))
  m.loadGrantSummaries.mockResolvedValue(new Map([['img-1', { tenantIds: ['t1'], vdcIds: ['v1'] }]]))
  m.loadGrantSummary.mockResolvedValue({ tenantIds: ['t1'], vdcIds: [] })
  m.replaceTenantGrants.mockResolvedValue(undefined)
})

describe('GET custom images', () => {
  it('gives the provider the grants of every row, empty when none', async () => {
    const json = await readJson<any>(await callRoute(LIST as any, { method: 'GET' }))
    expect(m.loadGrantSummaries).toHaveBeenCalledWith('image', ['img-1', 'img-2'])
    expect(json.data.map((i: any) => i.grants)).toEqual([{ tenantIds: ['t1'], vdcIds: ['v1'] }, { tenantIds: [], vdcIds: [] }])
  })

  it('gives a tenant its rows without any grant', async () => {
    m.tenant.mockResolvedValue('tenant-1')
    const json = await readJson<any>(await callRoute(LIST as any, { method: 'GET' }))
    expect(m.loadGrantSummaries).not.toHaveBeenCalled()
    expect(json.data.every((i: any) => i.grants === undefined)).toBe(true)
  })

  it('adds the grant summary to one image for the provider only', async () => {
    const provider = await readJson<any>(await callRoute(GET_ONE as any, { method: 'GET', params }))
    expect(provider.data.grants).toEqual({ tenantIds: ['t1'], vdcIds: [] })
    m.tenant.mockResolvedValue('tenant-1')
    const tenant = await readJson<any>(await callRoute(GET_ONE as any, { method: 'GET', params }))
    expect(tenant.data.grants).toBeUndefined()
  })

  it('answers 404 on an unknown image', async () => {
    m.findUnique.mockResolvedValue(null)
    expect((await callRoute(GET_ONE as any, { method: 'GET', params })).status).toBe(404)
  })
})

describe('writing the tenant grants', () => {
  it('stores the grants of an image the provider creates', async () => {
    const res = await callRoute(POST as any, { method: 'POST', body: { ...urlImage, grantTenantIds: ['t1', 't2'] } })
    expect(res.status).toBeLessThan(300)
    expect(m.replaceTenantGrants).toHaveBeenCalledWith('image', 'img-new', ['t1', 't2'], 'user-p')
  })

  it('ignores the grants a tenant sends on create', async () => {
    m.tenant.mockResolvedValue('tenant-1')
    const res = await callRoute(POST as any, { method: 'POST', body: { ...urlImage, grantTenantIds: ['t2'] } })
    expect(res.status).toBeLessThan(300)
    expect(m.replaceTenantGrants).not.toHaveBeenCalled()
  })

  it('replaces the grants on a provider edit, never writing them into the row', async () => {
    const res = await callRoute(PUT as any, { method: 'PUT', params, body: { name: 'a2', grantTenantIds: ['t3'] } })
    expect(res.status).toBe(200)
    expect(m.update.mock.calls[0][0].data).not.toHaveProperty('grantTenantIds')
    expect(m.replaceTenantGrants).toHaveBeenCalledWith('image', 'img-1', ['t3'], null)
  })

  it('ignores the grants and the visibility a tenant sends on edit', async () => {
    m.tenant.mockResolvedValue('tenant-1')
    const res = await callRoute(PUT as any, { method: 'PUT', params, body: { name: 'a2', isShared: true, grantTenantIds: ['t3'] } })
    expect(res.status).toBe(200)
    expect(m.update.mock.calls[0][0].data).not.toHaveProperty('isShared')
    expect(m.replaceTenantGrants).not.toHaveBeenCalled()
  })
})
