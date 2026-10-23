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

import { checkVnetPermission } from './vnetPermission'

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
