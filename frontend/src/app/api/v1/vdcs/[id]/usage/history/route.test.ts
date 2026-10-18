/**
 * GET /api/v1/vdcs/{id}/usage/history (#902): a tenant reads the history of
 * its own vDCs only.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  checkPermissionMock, getRBACContextMock, getAccessibleResourcesMock,
  getVdcByIdMock, getCurrentTenantIdMock, usageHistoryResponseMock, findHistoryIdentityMock,
} = vi.hoisted(() => ({
  findHistoryIdentityMock: vi.fn(),
  checkPermissionMock: vi.fn(),
  getRBACContextMock: vi.fn(),
  getAccessibleResourcesMock: vi.fn(),
  getVdcByIdMock: vi.fn(),
  getCurrentTenantIdMock: vi.fn(),
  usageHistoryResponseMock: vi.fn(),
}))

vi.mock('@/lib/rbac', () => ({
  checkPermission: checkPermissionMock,
  getRBACContext: getRBACContextMock,
  getAccessibleResources: getAccessibleResourcesMock,
  PERMISSIONS: { VM_VIEW: 'vm.view' },
}))
vi.mock('@/lib/vdc', () => ({ getVdcById: getVdcByIdMock }))
vi.mock('@/lib/tenant', () => ({ getCurrentTenantId: getCurrentTenantIdMock }))
vi.mock('@/lib/vdc/usageHistory/http', () => ({ usageHistoryResponse: usageHistoryResponseMock }))
vi.mock('@/lib/vdc/usageHistory/deleted', () => ({ findHistoryIdentity: findHistoryIdentityMock }))

import { GET } from './route'

const vdc = { id: 'v1', name: 'ACME', tenantId: 't1', connectionId: 'conn-A', pvePoolName: 'pool-a', nodes: ['n1'] }
const call = (id = 'v1') =>
  GET({ nextUrl: new URL(`http://x/api/v1/vdcs/${id}/usage/history?bucket=day`) } as any, { params: Promise.resolve({ id }) })

beforeEach(() => {
  vi.clearAllMocks()
  checkPermissionMock.mockResolvedValue(null)
  getCurrentTenantIdMock.mockResolvedValue('t1')
  getVdcByIdMock.mockResolvedValue(vdc)
  getRBACContextMock.mockResolvedValue({ userId: 'u1', isAdmin: true, tenantId: 't1' })
  usageHistoryResponseMock.mockResolvedValue(new Response('ok'))
  findHistoryIdentityMock.mockResolvedValue(null)
})

const gone = { id: 'v9', name: 'Old', tenantId: 't1', tenantName: 'T1', connectionId: 'conn-A', pvePoolName: 'pool-old' }

describe('GET /api/v1/vdcs/{id}/usage/history', () => {
  it('answers for a vDC of the current tenant', async () => {
    const res = await call()

    expect(await res.text()).toBe('ok')
    expect(usageHistoryResponseMock).toHaveBeenCalledWith(
      { id: 'v1', name: 'ACME', tenantId: 't1', connectionId: 'conn-A', pvePoolName: 'pool-a', nodes: ['n1'] },
      expect.any(URLSearchParams),
      undefined,
      { deleted: false },
    )
    expect(usageHistoryResponseMock.mock.calls[0][1].get('bucket')).toBe('day')
  })

  it('refuses the vDC of another tenant with 403', async () => {
    getVdcByIdMock.mockResolvedValue({ ...vdc, tenantId: 't2' })

    expect((await call()).status).toBe(403)
    expect(usageHistoryResponseMock).not.toHaveBeenCalled()
  })

  it('answers for a deleted vDC of the current tenant from its kept samples', async () => {
    getVdcByIdMock.mockResolvedValue(null)
    findHistoryIdentityMock.mockResolvedValue(gone)

    expect((await call('v9')).status).toBe(200)
    expect(usageHistoryResponseMock.mock.calls[0][0]).toMatchObject({ id: 'v9', name: 'Old', tenantId: 't1' })
    expect(usageHistoryResponseMock.mock.calls[0][3]).toEqual({ deleted: true })
  })

  it('refuses the deleted vDC of another tenant with 403', async () => {
    getVdcByIdMock.mockResolvedValue(null)
    findHistoryIdentityMock.mockResolvedValue({ ...gone, tenantId: 't2' })

    expect((await call('v9')).status).toBe(403)
    expect(usageHistoryResponseMock).not.toHaveBeenCalled()
  })

  it('answers 404 for an unknown vDC', async () => {
    getVdcByIdMock.mockResolvedValue(null)

    expect((await call()).status).toBe(404)
  })

  it('passes a permission refusal through', async () => {
    checkPermissionMock.mockResolvedValue(new Response('no', { status: 403 }))

    expect((await call()).status).toBe(403)
    expect(getVdcByIdMock).not.toHaveBeenCalled()
  })

  it('refuses a vDC the user grants do not cover', async () => {
    getRBACContextMock.mockResolvedValue({ userId: 'u1', isAdmin: false, tenantId: 't1' })
    getAccessibleResourcesMock.mockResolvedValue([{ scope_type: 'connection', scope_target: 'conn-B' }])

    expect((await call()).status).toBe(403)
  })

  it('answers for a vDC the user grants cover', async () => {
    getRBACContextMock.mockResolvedValue({ userId: 'u1', isAdmin: false, tenantId: 't1' })
    getAccessibleResourcesMock.mockResolvedValue([{ scope_type: 'pool', scope_target: 'pool-a' }])

    expect((await call()).status).toBe(200)
  })

  it('keeps the tenant boundary when the grant resolver fails', async () => {
    getRBACContextMock.mockResolvedValue({ userId: 'u1', isAdmin: false, tenantId: 't1' })
    getAccessibleResourcesMock.mockRejectedValue(new Error('boom'))

    expect((await call()).status).toBe(200)
  })

  it('answers 500 on an unexpected error', async () => {
    getVdcByIdMock.mockRejectedValue(new Error('db down'))
    const res = await call()

    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('db down')
  })
})
