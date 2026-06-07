import { beforeEach, describe, expect, it, vi } from 'vitest'

import { callRoute } from '../../../../__tests__/setup/route-test'

const { connectionCreateMock, providerConnectionCreateMock, checkPermissionMock } = vi.hoisted(() => ({
  connectionCreateMock: vi.fn(),
  providerConnectionCreateMock: vi.fn(),
  checkPermissionMock: vi.fn(),
}))
let currentTenant = 'default'

vi.mock('@/lib/tenant', () => ({
  getSessionPrisma: vi.fn(),
  getCurrentTenantId: async () => currentTenant,
  DEFAULT_TENANT_ID: 'default',
}))
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    $transaction: async (cb: any) =>
      cb({
        connection: { create: connectionCreateMock },
        providerConnection: { create: providerConnectionCreateMock },
      }),
  },
}))
vi.mock('@/lib/rbac', () => ({
  checkPermission: () => checkPermissionMock(),
  PERMISSIONS: { CONNECTION_VIEW: 'connection.view', CONNECTION_MANAGE: 'connection.manage' },
}))
vi.mock('@/lib/vdc/scope', () => ({ getVdcScope: async () => null }))
vi.mock('@/lib/crypto/secret', () => ({ encryptSecret: (s: string) => `enc:${s}` }))
vi.mock('@/lib/schemas', () => ({ createConnectionSchema: { safeParse: (b: any) => ({ success: true, data: b }) } }))
vi.mock('@/lib/proxmox/pbs-client', () => ({ pbsFetch: vi.fn() }))
vi.mock('@/lib/proxmox/client', () => ({ pveFetch: vi.fn().mockResolvedValue([]) }))
vi.mock('@/lib/orchestrator/client', () => ({ orchestratorFetch: vi.fn() }))
vi.mock('@/lib/proxmox/discoverNodeIps', () => ({ discoverNodeIps: vi.fn() }))
vi.mock('@/lib/proxmox/pbsFingerprint', () => ({ captureFingerprint: vi.fn() }))
vi.mock('@/lib/audit', () => ({ audit: vi.fn() }))

beforeEach(() => {
  currentTenant = 'default'
  checkPermissionMock.mockReset().mockResolvedValue(null)
  providerConnectionCreateMock.mockReset().mockResolvedValue({})
  connectionCreateMock.mockReset()
})

const body = { name: 'c', type: 'pve', baseUrl: 'https://x', insecureTLS: true, apiToken: 't' }

describe('connection POST pool maintenance', () => {
  it('adds a provider_connections row for a default-tenant PVE connection', async () => {
    connectionCreateMock.mockResolvedValue({ id: 'pve-1', type: 'pve' })
    const { POST } = await import('./route')
    await callRoute(POST, { body })
    expect(providerConnectionCreateMock).toHaveBeenCalledWith({ data: { connectionId: 'pve-1' } })
  })

  it('does NOT add a pool row for a PBS connection', async () => {
    connectionCreateMock.mockResolvedValue({ id: 'pbs-1', type: 'pbs' })
    const { POST } = await import('./route')
    await callRoute(POST, { body: { ...body, type: 'pbs' } })
    expect(providerConnectionCreateMock).not.toHaveBeenCalled()
  })

  it('does NOT add a pool row when created from a non-default tenant', async () => {
    currentTenant = 'tenant-x'
    connectionCreateMock.mockResolvedValue({ id: 'pve-2', type: 'pve' })
    const { POST } = await import('./route')
    await callRoute(POST, { body })
    expect(providerConnectionCreateMock).not.toHaveBeenCalled()
  })
})
