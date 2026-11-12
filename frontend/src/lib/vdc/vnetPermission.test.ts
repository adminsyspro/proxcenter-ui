import { beforeEach, describe, expect, it, vi } from 'vitest'

const { checkPermissionMock, getCurrentTenantIdMock, vdcFindUniqueMock } = vi.hoisted(() => ({
  checkPermissionMock: vi.fn(),
  getCurrentTenantIdMock: vi.fn(),
  vdcFindUniqueMock: vi.fn(),
}))

vi.mock('@/lib/rbac', () => ({ checkPermission: checkPermissionMock }))
vi.mock('@/lib/tenant', () => ({ getCurrentTenantId: getCurrentTenantIdMock }))
vi.mock('@/lib/db/prisma', () => ({ prisma: { vdc: { findUnique: vdcFindUniqueMock } } }))
vi.mock('@/lib/api-tokens/scope', () => ({ resolveVisibleConnectionIds: vi.fn() }))

import { checkVnetPermission, checkVnetReadForCaller } from './vnetPermission'

beforeEach(() => {
  vi.clearAllMocks()
  checkPermissionMock.mockResolvedValue(null)
})

describe('checkVnetPermission for sessions', () => {
  it('allows a real default-tenant session without looking up the vDC', async () => {
    getCurrentTenantIdMock.mockResolvedValue('default')

    await expect(checkVnetPermission(undefined, 'vdc-any', 'sdn.vnet.view')).resolves.toBeNull()
    expect(vdcFindUniqueMock).not.toHaveBeenCalled()
  })

  it('answers 404 when a tenant session asks for another tenant vDC', async () => {
    getCurrentTenantIdMock.mockResolvedValue('tenant-a')
    vdcFindUniqueMock.mockResolvedValue({ tenantId: 'tenant-b', connectionId: 'conn-1' })

    const response = await checkVnetPermission(undefined, 'vdc-b', 'sdn.vnet.view')

    expect(response?.status).toBe(404)
    await expect(response?.json()).resolves.toEqual({ error: 'vDC not found' })
    expect(vdcFindUniqueMock).toHaveBeenCalledWith({
      where: { id: 'vdc-b' },
      select: { tenantId: true, connectionId: true },
    })
  })
})

describe('checkVnetReadForCaller', () => {
  it('keeps the plain permission check for a session, without looking up the vDC', async () => {
    const denied = new Response(null, { status: 403 })
    checkPermissionMock.mockResolvedValue(denied)

    await expect(checkVnetReadForCaller(undefined, 'vdc-a', 'sdn.vnet.view')).resolves.toBe(denied)
    expect(checkPermissionMock).toHaveBeenCalledWith('sdn.vnet.view')
    expect(vdcFindUniqueMock).not.toHaveBeenCalled()
  })

  it('judges a token on its tenant: another tenant vDC answers 404', async () => {
    vdcFindUniqueMock.mockResolvedValue({ tenantId: 'tenant-b', connectionId: 'conn-1' })
    const token = { kind: 'token', tenantId: 'tenant-a', connectionIds: null } as never

    const response = await checkVnetReadForCaller(token, 'vdc-b', 'sdn.vnet.view')

    expect(response?.status).toBe(404)
    expect(checkPermissionMock).not.toHaveBeenCalled()
  })
})
