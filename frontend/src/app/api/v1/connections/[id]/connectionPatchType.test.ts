import { beforeEach, describe, expect, it, vi } from 'vitest'

import { callRoute } from '../../../../../__tests__/setup/route-test'

const { findUniqueMock, updateMock, checkPermissionMock } = vi.hoisted(() => ({
  findUniqueMock: vi.fn(),
  updateMock: vi.fn(),
  checkPermissionMock: vi.fn(),
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

beforeEach(() => {
  checkPermissionMock.mockReset().mockResolvedValue(null)
  findUniqueMock.mockReset()
  updateMock.mockReset().mockResolvedValue({ id: 'pve-1' })
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
