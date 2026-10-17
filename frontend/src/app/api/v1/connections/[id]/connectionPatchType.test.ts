import { beforeEach, describe, expect, it, vi } from 'vitest'

import { callRoute } from '../../../../../__tests__/setup/route-test'

const { findUniqueMock, updateMock, checkPermissionMock, hasServerFeatureMock } = vi.hoisted(() => ({
  findUniqueMock: vi.fn(),
  updateMock: vi.fn(),
  checkPermissionMock: vi.fn(),
  hasServerFeatureMock: vi.fn(),
}))

vi.mock('@/lib/tenant', () => ({
  getSessionPrisma: async () => ({ connection: { findUnique: findUniqueMock, update: updateMock } }),
  getCurrentTenantId: async () => 'default',
}))
vi.mock('@/lib/db/prisma', () => ({ prisma: { connection: { findUnique: vi.fn() } } }))
vi.mock('@/lib/rbac', () => ({
  checkPermission: () => checkPermissionMock(),
  PERMISSIONS: { CONNECTION_MANAGE: 'connection.manage' },
}))
vi.mock('@/lib/vdc/scope', () => ({ getVdcScope: async () => null }))
vi.mock('@/lib/crypto/secret', () => ({ encryptSecret: (s: string) => `enc:${s}`, decryptSecret: (s: string) => s }))
vi.mock('@/lib/schemas', () => ({ updateConnectionSchema: { safeParse: (b: any) => ({ success: true, data: b }) } }))
vi.mock('@/lib/proxmox/client', () => ({ pveFetch: vi.fn() }))
vi.mock('@/lib/proxmox/discoverNodeIps', () => ({ discoverNodeIps: vi.fn() }))
vi.mock('@/lib/orchestrator/client', () => ({ orchestratorFetch: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/audit', () => ({ audit: vi.fn() }))
vi.mock('@/lib/connections/getConnection', () => ({ invalidateConnectionCache: vi.fn() }))
vi.mock('@/lib/cache/inventoryCache', () => ({ invalidateInventoryCache: vi.fn() }))
vi.mock('@/lib/auth/requireEnterprise', () => ({ hasServerFeature: (id: string) => hasServerFeatureMock(id) }))

beforeEach(() => {
  checkPermissionMock.mockReset().mockResolvedValue(null)
  findUniqueMock.mockReset()
  updateMock.mockReset().mockResolvedValue({ id: 'pve-1' })
  hasServerFeatureMock.mockReset().mockResolvedValue(true)
})

describe('PATCH /api/v1/connections/[id] type immutability', () => {
  it('rejects a type change with 400', async () => {
    findUniqueMock.mockResolvedValue({ type: 'pve' })
    const { PATCH } = await import('./route')
    const res = await callRoute(PATCH, { method: 'PATCH', params: { id: 'pve-1' }, body: { type: 'pbs' } })
    expect(res.status).toBe(400)
    expect(updateMock).not.toHaveBeenCalled()
  })

  it('allows a PATCH that repeats the same type', async () => {
    findUniqueMock.mockResolvedValue({ type: 'pve' })
    const { PATCH } = await import('./route')
    const res = await callRoute(PATCH, { method: 'PATCH', params: { id: 'pve-1' }, body: { type: 'pve', name: 'renamed' } })
    expect(res.status).toBe(200)
    expect(updateMock).toHaveBeenCalled()
  })
})

describe('PATCH /api/v1/connections/[id] warm zeroing cap (roadmap#45)', () => {
  const patch = async (id: string, body: any) => {
    const { PATCH } = await import('./route')
    return callRoute(PATCH, { method: 'PATCH', params: { id }, body })
  }

  it('sets and clears the cap of a PVE connection on Enterprise', async () => {
    findUniqueMock.mockResolvedValue({ type: 'pve' })
    expect((await patch('pve-1', { warmZeroRateLimitMBps: 200 })).status).toBe(200)
    expect(updateMock.mock.calls[0][0].data.warmZeroRateLimitMBps).toBe(200)
    expect(hasServerFeatureMock).toHaveBeenCalledWith('vmware_migration')

    expect((await patch('pve-1', { warmZeroRateLimitMBps: null })).status).toBe(200)
    expect(updateMock.mock.calls[1][0].data.warmZeroRateLimitMBps).toBeNull()
  })

  it('ignores it on Community and on a connection that is not PVE', async () => {
    hasServerFeatureMock.mockResolvedValue(false)
    findUniqueMock.mockResolvedValue({ type: 'pve' })
    await patch('pve-1', { warmZeroRateLimitMBps: 200, name: 'x' })
    expect(updateMock.mock.calls[0][0].data).not.toHaveProperty('warmZeroRateLimitMBps')

    hasServerFeatureMock.mockResolvedValue(true)
    findUniqueMock.mockResolvedValue({ type: 'vmware' })
    await patch('vc-1', { warmZeroRateLimitMBps: 200, name: 'x' })
    expect(updateMock.mock.calls[1][0].data).not.toHaveProperty('warmZeroRateLimitMBps')
  })
})
