// roadmap#184: connection.view held on one cluster lists that cluster, not the tenant's fleet.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({ scope: null as any, pveFetch: vi.fn() }))

vi.mock('@/lib/tenant', () => ({
  getSessionPrisma: async () => ({
    connection: { findMany: async () => [{ id: 'prod', name: 'PVE-PROD' }, { id: 'dr', name: 'PVE-DR' }] },
  }),
}))
vi.mock('@/lib/rbac', async () => {
  const { filterVisibleConnections } = await import('@/lib/rbac/infraScope')
  return {
    checkPermission: async () => null,
    getCurrentRbacInfraScope: async () => h.scope,
    filterVisibleConnections,
    PERMISSIONS: { CONNECTION_VIEW: 'connection.view' },
  }
})
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionById: async (id: string) => ({ id, baseUrl: `https://${id}`, apiToken: 't' }) }))
vi.mock('@/lib/proxmox/client', () => ({ pveFetch: h.pveFetch }))

import { GET } from './route'

beforeEach(() => {
  h.scope = null
  h.pveFetch.mockReset().mockImplementation(async (_conn: unknown, path: string) =>
    path === '/nodes' ? [{ node: 'a', status: 'online' }, { node: 'b', status: 'online' }] : [{ type: 'cluster', name: 'C' }])
})

const ids = async () => ((await (await GET()).json()).data as any[]).map(c => c.id)

describe('GET /api/v1/clusters scope', () => {
  it('lists every cluster for an unrestricted caller', async () => {
    expect(await ids()).toEqual(['prod', 'dr'])
  })

  it('lists the clusters the grants name only, without reading the others', async () => {
    h.scope = { fullConnections: new Set(['dr']), nodesByConnection: new Map(), guestDerived: false }

    expect(await ids()).toEqual(['dr'])
    expect(h.pveFetch.mock.calls.every(c => c[0].id === 'dr')).toBe(true)
  })
})
