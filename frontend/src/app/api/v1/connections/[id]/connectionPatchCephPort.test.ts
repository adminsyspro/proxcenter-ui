import { beforeEach, describe, expect, it, vi } from 'vitest'

import { callRoute } from '../../../../../__tests__/setup/route-test'

const { findUniqueMock, updateMock } = vi.hoisted(() => ({ findUniqueMock: vi.fn(), updateMock: vi.fn() }))

vi.mock('@/lib/tenant', () => ({
  getSessionPrisma: async () => ({ connection: { findUnique: findUniqueMock, update: updateMock } }),
  getCurrentTenantId: async () => 'default',
}))
vi.mock('@/lib/db/prisma', () => ({ prisma: { connection: { findUnique: vi.fn() } } }))
vi.mock('@/lib/rbac', () => ({
  checkPermission: async () => null,
  PERMISSIONS: { CONNECTION_MANAGE: 'connection.manage' },
}))
vi.mock('@/lib/vdc/scope', () => ({ getVdcScope: async () => null }))
vi.mock('@/lib/crypto/secret', () => ({ encryptSecret: (s: string) => `enc:${s}`, decryptSecret: (s: string) => s }))
vi.mock('@/lib/proxmox/client', () => ({ pveFetch: vi.fn() }))
vi.mock('@/lib/proxmox/discoverNodeIps', () => ({ discoverNodeIps: vi.fn() }))
vi.mock('@/lib/orchestrator/client', () => ({ orchestratorFetch: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/audit', () => ({ audit: vi.fn() }))
vi.mock('@/lib/connections/getConnection', () => ({ invalidateConnectionCache: vi.fn() }))
vi.mock('@/lib/cache/inventoryCache', () => ({ invalidateInventoryCache: vi.fn() }))
vi.mock('@/lib/auth/requireEnterprise', () => ({ hasServerFeature: async () => false }))

beforeEach(() => {
  findUniqueMock.mockReset().mockResolvedValue({ type: 'pve' })
  updateMock.mockReset().mockResolvedValue({ id: 'pve-1' })
})

describe('PATCH /api/v1/connections/[id] ceph-exporter port validation (real schema)', () => {
  const patch = async (body: any) => {
    const { PATCH } = await import('./route')
    return callRoute(PATCH, { method: 'PATCH', params: { id: 'pve-1' }, body })
  }

  it('400 on 0, 65536, 1.5 or a string, nothing written', async () => {
    for (const bad of [0, 65536, 1.5, '9926']) expect((await patch({ cephExporterPort: bad })).status, String(bad)).toBe(400)
    expect(updateMock).not.toHaveBeenCalled()
  })

  it('writes a valid port', async () => {
    expect((await patch({ cephExporterPort: 65535 })).status).toBe(200)
    expect(updateMock.mock.calls[0][0].data.cephExporterPort).toBe(65535)
  })
})
