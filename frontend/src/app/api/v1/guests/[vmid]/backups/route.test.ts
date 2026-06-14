import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

const checkPermissionMock = vi.fn<(...args: any[]) => Promise<Response | null>>()
const pbsFetchMock = vi.fn<(...args: any[]) => Promise<any>>()
const pveFetchMock = vi.fn<(...args: any[]) => Promise<any>>()
const getVdcScopeMock = vi.fn<(tenantId?: string) => Promise<any>>()
const getConnectionByIdMock = vi.fn<(id: string) => Promise<any>>()
const findManyMock = vi.fn<(args: any) => Promise<any[]>>()

vi.mock('@/lib/tenant', () => ({
  getSessionPrisma: async () => ({ connection: { findMany: findManyMock } }),
  getCurrentTenantId: async () => 'default',
}))
vi.mock('@/lib/db/prisma', () => ({ prisma: { connection: { findMany: findManyMock } } }))
vi.mock('@/lib/vdc/scope', () => ({ getVdcScope: getVdcScopeMock }))
vi.mock('@/lib/proxmox/pbs-client', () => ({ pbsFetch: pbsFetchMock }))
vi.mock('@/lib/proxmox/client', () => ({ pveFetch: pveFetchMock }))
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionById: getConnectionByIdMock }))
vi.mock('@/lib/crypto/secret', () => ({ decryptSecret: (s: string) => `dec:${s}` }))
vi.mock('@/lib/rbac', () => ({
  checkPermission: checkPermissionMock,
  PERMISSIONS: { BACKUP_VIEW: 'backup.view' },
}))
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => ({ value: 'en' }) }) }))

beforeEach(() => {
  checkPermissionMock.mockReset().mockResolvedValue(null)
  pbsFetchMock.mockReset().mockResolvedValue([])
  pveFetchMock.mockReset().mockResolvedValue([])
  getVdcScopeMock.mockReset().mockResolvedValue(null)
  getConnectionByIdMock.mockReset().mockResolvedValue({ id: 'pve-1', apiToken: 't' })
  findManyMock.mockReset().mockResolvedValue([])
})

async function call(connectionId?: string) {
  const { GET } = await import('./route')
  const res = await callRoute(GET as any, {
    params: { vmid: '1105' },
    searchParams: connectionId ? { connectionId } : undefined,
  })
  return readJson<any>(res)
}

describe('GET /api/v1/guests/[vmid]/backups — pbsConfigured (PBS connection mapped to the cluster)', () => {
  it('is false when no PBS connection exists at all', async () => {
    findManyMock.mockResolvedValue([])
    const body = await call('pve-1')
    expect(body.data.pbsConfigured).toBe(false)
  })

  it('is false when the cluster backs up to a PBS that is not a ProxCenter connection', async () => {
    // Real case: the cluster's pbs storage points to 10.199.199.231, but the
    // only PBS connection is 10.99.99.204 — they do not match.
    findManyMock.mockResolvedValue([
      { id: 'pbs-1', name: 'PBS', baseUrl: 'https://10.99.99.204:8007', insecureTLS: false, apiTokenEnc: 'enc' },
    ])
    pveFetchMock.mockResolvedValue([
      { storage: 'PBS_MASTER_RBX', type: 'pbs', server: '10.199.199.231', datastore: 'VM-BACKUP' },
      { storage: 'local', type: 'dir' },
    ])
    const body = await call('pve-1')
    expect(body.data.pbsConfigured).toBe(false)
  })

  it('is true when a ProxCenter PBS connection matches the cluster pbs storage host', async () => {
    findManyMock.mockResolvedValue([
      { id: 'pbs-1', name: 'PBS', baseUrl: 'https://10.199.199.231:8007', insecureTLS: false, apiTokenEnc: 'enc' },
    ])
    pveFetchMock.mockResolvedValue([
      { storage: 'PBS_MASTER_RBX', type: 'pbs', server: '10.199.199.231', datastore: 'VM-BACKUP' },
    ])
    const body = await call('pve-1')
    expect(body.data.pbsConfigured).toBe(true)
  })

  it('falls back to "a PBS connection exists" when no connectionId is provided', async () => {
    findManyMock.mockResolvedValue([
      { id: 'pbs-1', name: 'PBS', baseUrl: 'https://10.99.99.204:8007', insecureTLS: false, apiTokenEnc: 'enc' },
    ])
    const body = await call()
    expect(body.data.pbsConfigured).toBe(true)
  })

  it('falls back to "a PBS connection exists" when the cluster storage cannot be read', async () => {
    findManyMock.mockResolvedValue([
      { id: 'pbs-1', name: 'PBS', baseUrl: 'https://10.99.99.204:8007', insecureTLS: false, apiTokenEnc: 'enc' },
    ])
    pveFetchMock.mockRejectedValue(new Error('storage unreachable'))
    const body = await call('pve-1')
    expect(body.data.pbsConfigured).toBe(true)
  })
})
