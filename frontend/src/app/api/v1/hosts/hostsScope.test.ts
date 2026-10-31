// roadmap#184: node.view held on one node or cluster lists that perimeter, not the tenant's whole fleet.
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  scope: null as any,
  pveFetch: vi.fn(),
  listable: vi.fn(),
}))

vi.mock('@/lib/tenant', () => ({
  getSessionPrisma: async () => ({
    connection: { findMany: async () => [{ id: 'prod', name: 'PVE-PROD' }, { id: 'dr', name: 'PVE-DR' }] },
  }),
}))
vi.mock('@/lib/rbac', () => ({
  checkPermission: async () => null,
  getCurrentRbacInfraScope: async () => h.scope,
  mayHaveVisibleGuests: (scope: any, id: string) => scope.fullConnections.has(id) || scope.nodesByConnection.has(id),
  PERMISSIONS: { NODE_VIEW: 'node.view' },
}))
vi.mock('@/lib/rbac/nodeList', () => ({ listableNodes: h.listable }))
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionById: async (id: string) => ({ id, baseUrl: `https://${id}`, apiToken: 't' }) }))
vi.mock('@/lib/proxmox/client', () => ({ pveFetch: h.pveFetch }))

import { GET } from './route'

const nodes = (...names: string[]) => names.map(node => ({ type: 'node', node, status: 'online', cpu: 0.1, mem: 1, maxmem: 2 }))

beforeEach(() => {
  h.scope = null
  h.pveFetch.mockReset().mockImplementation(async (conn: any) => (conn.id === 'prod' ? nodes('pve1', 'pve2') : nodes('pve1-dr')))
  h.listable.mockReset().mockResolvedValue(null)
})

async function hostIds() {
  const res = await GET(new Request('http://x/api/v1/hosts'))
  const body = await res.json()

  return body.data.hosts.map((x: any) => x.id).sort()
}

describe('GET /api/v1/hosts scope', () => {
  it('lists every node of every cluster for an unrestricted caller', async () => {
    expect(await hostIds()).toEqual(['dr:pve1-dr', 'prod:pve1', 'prod:pve2'])
  })

  it('skips the clusters the grants do not name and keeps the named nodes only', async () => {
    h.scope = { fullConnections: new Set(), nodesByConnection: new Map([['prod', new Set(['pve2'])]]), guestDerived: false }
    h.listable.mockImplementation(async (_scope: unknown, id: string) => (id === 'prod' ? new Set(['pve2']) : new Set()))

    expect(await hostIds()).toEqual(['prod:pve2'])
    expect(h.pveFetch.mock.calls.map(c => c[0].id)).toEqual(['prod'])
  })

  it('still counts a cluster as one when a single node is shown', async () => {
    h.scope = { fullConnections: new Set(), nodesByConnection: new Map([['prod', new Set(['pve2'])]]), guestDerived: false }
    h.listable.mockResolvedValue(new Set(['pve2']))
    const res = await GET(new Request('http://x/api/v1/hosts?connId=prod'))

    expect((await res.json()).data.hosts[0].scope).toBe('cluster')
  })
})
