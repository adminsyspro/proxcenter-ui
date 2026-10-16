/**
 * GET /api/v1/admin/vdcs/{id}/usage/history (#902): provider only.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { checkPermissionMock, requireProviderTenantMock, getVdcByIdMock, usageHistoryResponseMock, findHistoryIdentityMock } = vi.hoisted(() => ({
  findHistoryIdentityMock: vi.fn(),
  checkPermissionMock: vi.fn(),
  requireProviderTenantMock: vi.fn(),
  getVdcByIdMock: vi.fn(),
  usageHistoryResponseMock: vi.fn(),
}))

vi.mock('@/lib/rbac', () => ({ checkPermission: checkPermissionMock, PERMISSIONS: { ADMIN_SETTINGS: 'admin.settings' } }))
vi.mock('@/lib/tenant', () => ({ requireProviderTenant: requireProviderTenantMock }))
vi.mock('@/lib/vdc', () => ({ getVdcById: getVdcByIdMock }))
vi.mock('@/lib/vdc/usageHistory/http', () => ({ usageHistoryResponse: usageHistoryResponseMock }))
vi.mock('@/lib/vdc/usageHistory/deleted', () => ({ findHistoryIdentity: findHistoryIdentityMock }))

import { GET } from './route'

const vdc = { id: 'v1', name: 'ACME', tenantId: 't9' }
const call = () => GET({ nextUrl: new URL('http://x/?format=csv') } as any, { params: Promise.resolve({ id: 'v1' }) })

beforeEach(() => {
  vi.clearAllMocks()
  requireProviderTenantMock.mockResolvedValue(null)
  checkPermissionMock.mockResolvedValue(null)
  getVdcByIdMock.mockResolvedValue(vdc)
  usageHistoryResponseMock.mockResolvedValue(new Response('csv'))
  findHistoryIdentityMock.mockResolvedValue(null)
})

describe('GET /api/v1/admin/vdcs/{id}/usage/history', () => {
  it('answers for any vDC from the provider tenant', async () => {
    expect(await (await call()).text()).toBe('csv')
    expect(usageHistoryResponseMock.mock.calls[0][1].get('format')).toBe('csv')
  })

  it('refuses outside the provider tenant', async () => {
    requireProviderTenantMock.mockResolvedValue(new Response('no', { status: 403 }))

    expect((await call()).status).toBe(403)
    expect(getVdcByIdMock).not.toHaveBeenCalled()
  })

  it('refuses without the settings permission', async () => {
    checkPermissionMock.mockResolvedValue(new Response('no', { status: 403 }))

    expect((await call()).status).toBe(403)
  })

  it('answers for a deleted vDC from its kept samples', async () => {
    getVdcByIdMock.mockResolvedValueOnce(null)
    findHistoryIdentityMock.mockResolvedValueOnce({ id: 'v1', name: 'Gone', tenantId: 't9' })

    expect((await call()).status).toBe(200)
    expect(usageHistoryResponseMock.mock.calls[0][0]).toMatchObject({ id: 'v1', name: 'Gone' })
    expect(usageHistoryResponseMock.mock.calls[0][3]).toEqual({ deleted: true })
  })

  it('answers 404 for an unknown vDC and 500 on an error', async () => {
    getVdcByIdMock.mockResolvedValueOnce(null)
    expect((await call()).status).toBe(404)

    getVdcByIdMock.mockRejectedValueOnce(new Error('boom'))
    expect((await call()).status).toBe(500)
  })
})
