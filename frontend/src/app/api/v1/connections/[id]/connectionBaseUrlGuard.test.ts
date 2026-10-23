import { beforeEach, describe, expect, it, vi } from 'vitest'

import { callRoute } from '../../../../../__tests__/setup/route-test'

// A customer tenant may not point a connection at this host (loopback, the
// metadata range, the unspecified address): the PATCH route asks the guard
// before writing a new baseUrl, the provider tenant is never routed through it.
const { findUniqueMock, updateMock, guardMock, tenant } = vi.hoisted(() => ({
  findUniqueMock: vi.fn(),
  updateMock: vi.fn(),
  guardMock: vi.fn(),
  tenant: { id: 'default' },
}))

vi.mock('@/lib/tenant', () => ({
  getSessionPrisma: async () => ({ connection: { findUnique: findUniqueMock, update: updateMock } }),
  getCurrentTenantId: async () => tenant.id,
}))
vi.mock('@/lib/net/base-url-guard', () => ({ tenantBaseUrlRefusal: (...a: unknown[]) => guardMock(...a) }))
vi.mock('@/lib/db/prisma', () => ({ prisma: { connection: { findUnique: vi.fn() } } }))
vi.mock('@/lib/rbac', () => ({
  checkPermission: async () => null,
  PERMISSIONS: { CONNECTION_MANAGE: 'connection.manage' },
}))
vi.mock('@/lib/vdc/scope', () => ({ getVdcScope: async () => null }))
vi.mock('@/lib/crypto/secret', () => ({ encryptSecret: (s: string) => `enc:${s}`, decryptSecret: (s: string) => s }))
vi.mock('@/lib/schemas', () => ({ updateConnectionSchema: { safeParse: (b: any) => ({ success: true, data: b }) } }))
vi.mock('@/lib/proxmox/client', () => ({ pveFetch: vi.fn().mockResolvedValue([]) }))
vi.mock('@/lib/proxmox/discoverNodeIps', () => ({ discoverNodeIps: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/orchestrator/client', () => ({ orchestratorFetch: vi.fn().mockResolvedValue(undefined) }))
vi.mock('@/lib/audit', () => ({ audit: vi.fn() }))
vi.mock('@/lib/connections/getConnection', () => ({ invalidateConnectionCache: vi.fn() }))
vi.mock('@/lib/cache/inventoryCache', () => ({ invalidateInventoryCache: vi.fn() }))
vi.mock('@/lib/cache/guestIpCache', () => ({ invalidateGuestIpIndex: vi.fn() }))
vi.mock('@/lib/auth/requireEnterprise', () => ({ hasServerFeature: async () => true }))

const patch = async (body: any) => {
  const { PATCH } = await import('./route')
  return callRoute(PATCH, { method: 'PATCH', params: { id: 'vmware-1' }, body })
}

beforeEach(() => {
  tenant.id = 'default'
  findUniqueMock.mockReset().mockResolvedValue({ type: 'vmware', subType: 'esxi', baseUrl: 'https://10.0.0.1', apiTokenEnc: 'enc:t', insecureTLS: true })
  updateMock.mockReset().mockResolvedValue({ id: 'vmware-1', name: 'esx' })
  guardMock.mockReset().mockResolvedValue(null)
})

describe('PATCH /api/v1/connections/[id] base URL guard', () => {
  it('refuses a customer tenant whose new baseUrl the guard rejects, before any write', async () => {
    tenant.id = 'acme'
    guardMock.mockResolvedValue('Connection address "127.0.0.1" is not allowed: loopback address')

    const res = await patch({ baseUrl: 'https://127.0.0.1:8006' })

    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/loopback/)
    expect(guardMock).toHaveBeenCalledWith('https://127.0.0.1:8006')
    expect(updateMock).not.toHaveBeenCalled()
  })

  it('lets a customer tenant save an address the guard accepts', async () => {
    tenant.id = 'acme'

    const res = await patch({ baseUrl: 'https://10.0.0.9:8006' })

    expect(res.status).toBe(200)
    expect(guardMock).toHaveBeenCalledWith('https://10.0.0.9:8006')
    expect(updateMock.mock.calls[0][0].data.baseUrl).toBe('https://10.0.0.9:8006')
  })

  it('never consults the guard for the provider tenant, nor when baseUrl is not part of the update', async () => {
    expect((await patch({ baseUrl: 'https://127.0.0.1:8006' })).status).toBe(200)
    tenant.id = 'acme'
    expect((await patch({ name: 'renamed' })).status).toBe(200)
    expect(guardMock).not.toHaveBeenCalled()
  })
})
