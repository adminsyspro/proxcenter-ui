import { beforeEach, describe, expect, it, vi } from 'vitest'

// fetchRawInventory feeds the inventory cache of a tenant: for an IaaS tenant
// it never reads the Ceph of the shared provider cluster, so no cephHealth
// can reach the tree, the tools or the metrics built on top of it.
const { pveFetchMock, findManyMock } = vi.hoisted(() => ({
  pveFetchMock: vi.fn(),
  findManyMock: vi.fn(),
}))

vi.mock('@/lib/tenant', () => ({
  getSessionPrisma: async () => ({ connection: { findMany: findManyMock } }),
  getCurrentTenantId: async () => 'default',
}))
vi.mock('@/lib/db/prisma', () => ({ prisma: { connection: { findMany: findManyMock } } }))
vi.mock('@/lib/connections/getConnection', () => ({
  getConnectionById: async (id: string) => ({ id }),
  getPbsConnectionById: async (id: string) => ({ id }),
}))
vi.mock('@/lib/proxmox/client', () => ({ pveFetch: (...a: any[]) => pveFetchMock(...a) }))
vi.mock('@/lib/proxmox/pbs-client', () => ({ pbsFetch: async () => [] }))

import { fetchRawInventory } from './fetchRawInventory'

const cephCalls = () => pveFetchMock.mock.calls.filter(([, path]) => String(path).includes('ceph'))

beforeEach(() => {
  vi.clearAllMocks()
  findManyMock.mockImplementation(async ({ where }: any) =>
    where?.type === 'pve' ? [{ id: 'connA', name: 'Shared', type: 'pve', tenantId: 'default' }] : [])
  pveFetchMock.mockImplementation(async (_c: any, path: string) => {
    if (path === '/nodes') return [{ node: 'n1', status: 'online' }]
    if (path === '/cluster/ceph/status') return { health: { status: 'HEALTH_ERR' } }
    return []
  })
})

describe('fetchRawInventory: Ceph of a shared cluster', () => {
  it('iaas: never calls /cluster/ceph/status, no cephHealth on the cluster', async () => {
    const raw = await fetchRawInventory({ kind: 'iaas', vdcScope: { connectionIds: new Set(['connA']) } } as any)
    expect(raw.clusters.map(c => c.id)).toEqual(['connA'])
    expect(raw.clusters[0].cephHealth).toBeUndefined()
    expect(cephCalls()).toEqual([])
  })

  it('provider and msp keep the Ceph health', async () => {
    const provider = await fetchRawInventory({ kind: 'provider' } as any)
    expect(provider.clusters[0].cephHealth).toBe('HEALTH_ERR')
    const msp = await fetchRawInventory({ kind: 'msp', connectionIds: new Set(['connA']) } as any)
    expect(msp.clusters[0].cephHealth).toBe('HEALTH_ERR')
  })
})
