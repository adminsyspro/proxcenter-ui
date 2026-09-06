/**
 * Security: GET /api/v1/orchestrator/drs/status is a tenant boundary in front
 * of a cluster-wide orchestrator endpoint. It used to spread the upstream
 * payload verbatim and recompute only the recommendation and migration
 * counts, so the pinned_guests and balancing_domains rows added with the DRS
 * placement filter reached every tenant with other tenants' guest names,
 * nodes and blocker reasons.
 *
 * These tests pin the corrected behaviour: both row-shaped fields are
 * filtered on connection_id, the derived count follows the filtered list, and
 * a row carrying no connection_id is dropped rather than shown to everyone.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { callRoute } from '@/__tests__/setup/route-test'

const { tenantConnectionIdsMock, getDRSStatusMock, getRecommendationsMock, getActiveMigrationsMock, rbacScopeMock } = vi.hoisted(() => ({
  tenantConnectionIdsMock: vi.fn(),
  getDRSStatusMock: vi.fn(),
  getRecommendationsMock: vi.fn(),
  getActiveMigrationsMock: vi.fn(),
  rbacScopeMock: vi.fn()
}))

vi.mock('@/lib/tenant', () => ({
  getTenantConnectionIds: (...a: any[]) => tenantConnectionIdsMock(...a)
}))

vi.mock('@/lib/rbac', () => ({
  checkPermission: vi.fn().mockResolvedValue(null),
  getCurrentRbacInfraScope: (...a: any[]) => rbacScopeMock(...a),
  PERMISSIONS: { AUTOMATION_VIEW: 'automation.view', CONNECTION_VIEW: 'connection.view' }
}))

vi.mock('@/lib/orchestrator/client', () => ({
  getOrchestratorClient: () => ({
    getDRSStatus: (...a: any[]) => getDRSStatusMock(...a),
    getRecommendations: (...a: any[]) => getRecommendationsMock(...a),
    getActiveMigrations: (...a: any[]) => getActiveMigrationsMock(...a)
  })
}))

const upstreamStatus = {
  enabled: true,
  mode: 'manual',
  recommendations: 3,
  active_migrations: 0,
  pending_count: 3,
  approved_count: 0,
  pinned_guest_count: 3,
  pinned_guests: [
    { connection_id: 'mine', vmid: 9101, name: 'dmz-a', node: 'n1', reason: 'vnet vdmz unavailable on n2' },
    { connection_id: 'theirs', vmid: 500, name: 'their-secret-vm', node: 'their-node', reason: 'storage X' },
    { vmid: 777, name: 'orphan', node: 'n9', reason: 'no connection at all' }
  ],
  balancing_domains: [
    { connection_id: 'mine', nodes: ['n1'], guests: 2, spread: 0 },
    { connection_id: 'theirs', nodes: ['their-node-a', 'their-node-b'], guests: 5, spread: 12.5 },
    { nodes: ['n9'], guests: 1, spread: 0 }
  ]
}

const readBody = async (res: any) => JSON.parse(await res.text())

describe('GET /api/v1/orchestrator/drs/status tenant scoping', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    tenantConnectionIdsMock.mockResolvedValue(new Set(['mine']))
    // null scope = unrestricted (admin), the default for most of these tests.
    rbacScopeMock.mockResolvedValue(null)
    getDRSStatusMock.mockResolvedValue({ data: upstreamStatus })
    getRecommendationsMock.mockResolvedValue({ data: [] })
    getActiveMigrationsMock.mockResolvedValue({ data: [] })
  })

  it('keeps only the pinned guests of the caller s connections', async () => {
    const { GET } = await import('./route')
    const body = await readBody(await callRoute(GET as any))

    expect(body.pinned_guests).toHaveLength(1)
    expect(body.pinned_guests[0].vmid).toBe(9101)
    expect(JSON.stringify(body)).not.toContain('their-secret-vm')
    expect(JSON.stringify(body)).not.toContain('their-node')
  })

  it('recomputes pinned_guest_count from the filtered list, not upstream', async () => {
    const { GET } = await import('./route')
    const body = await readBody(await callRoute(GET as any))

    expect(body.pinned_guest_count).toBe(1)
  })

  it('keeps only the balancing domains of the caller s connections', async () => {
    const { GET } = await import('./route')
    const body = await readBody(await callRoute(GET as any))

    expect(body.balancing_domains).toHaveLength(1)
    expect(body.balancing_domains[0].nodes).toEqual(['n1'])
  })

  it('drops a row with no connection_id rather than showing it to everyone', async () => {
    const { GET } = await import('./route')
    const body = await readBody(await callRoute(GET as any))

    expect(body.pinned_guests.some((g: any) => g.vmid === 777)).toBe(false)
    expect(body.balancing_domains.some((d: any) => d.nodes.includes('n9'))).toBe(false)
  })

  it('answers empty rather than upstream when the tenant owns no connection', async () => {
    tenantConnectionIdsMock.mockResolvedValue(new Set())
    const { GET } = await import('./route')
    const body = await readBody(await callRoute(GET as any))

    expect(body.pinned_guests).toEqual([])
    expect(body.pinned_guest_count).toBe(0)
    expect(body.balancing_domains).toEqual([])
  })

  it('tolerates an orchestrator that does not send the fields at all', async () => {
    getDRSStatusMock.mockResolvedValue({ data: { enabled: true, mode: 'manual' } })
    const { GET } = await import('./route')
    const body = await readBody(await callRoute(GET as any))

    expect(body.pinned_guests).toEqual([])
    expect(body.pinned_guest_count).toBe(0)
    expect(body.balancing_domains).toEqual([])
    expect(body.enabled).toBe(true)
  })

  it('falls back to an empty, safe payload when the orchestrator is down', async () => {
    getDRSStatusMock.mockRejectedValue(Object.assign(new Error('down'), { code: 'ORCHESTRATOR_UNAVAILABLE' }))
    const { GET } = await import('./route')
    const body = await readBody(await callRoute(GET as any))

    expect(body.enabled).toBe(false)
    expect(body.pinned_guests).toEqual([])
    expect(body.balancing_domains).toEqual([])
  })
})

describe('GET /api/v1/orchestrator/drs/status RBAC infra scoping', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Both connections belong to the tenant: only the RBAC scope narrows them.
    tenantConnectionIdsMock.mockResolvedValue(new Set(['mine', 'theirs']))
    getRecommendationsMock.mockResolvedValue({ data: [] })
    getActiveMigrationsMock.mockResolvedValue({ data: [] })
    getDRSStatusMock.mockResolvedValue({
      data: {
        enabled: true,
        mode: 'manual',
        pinned_guests: [
          { connection_id: 'mine', vmid: 9101, name: 'dmz-a', node: 'n1', reason: 'vnet' },
          { connection_id: 'mine', vmid: 9201, name: 'users-a', node: 'n2', reason: 'vnet' },
          { connection_id: 'theirs', vmid: 500, name: 'their-vm', node: 'their-node', reason: 'storage' }
        ],
        balancing_domains: [
          { connection_id: 'mine', nodes: ['n1'], guests: 1, spread: 0 },
          { connection_id: 'mine', nodes: ['n1', 'n2'], guests: 2, spread: 4 },
          { connection_id: 'theirs', nodes: ['their-node'], guests: 1, spread: 0 }
        ]
      }
    })
  })

  // A user granted node n1 of connection "mine" and nothing else.
  const nodeScopedToN1 = {
    fullConnections: new Set<string>(),
    guestDerived: false,
    nodesByConnection: new Map([['mine', new Set(['n1'])]]),
    guestGrantsByConnection: new Map()
  }

  it('keeps only the guests of the nodes the caller is granted', async () => {
    rbacScopeMock.mockResolvedValue(nodeScopedToN1)
    const { GET } = await import('./route')
    const body = await readBody(await callRoute(GET as any))

    expect(body.pinned_guests.map((g: any) => g.vmid)).toEqual([9101])
    expect(body.pinned_guest_count).toBe(1)
    expect(JSON.stringify(body)).not.toContain('their-vm')
    expect(JSON.stringify(body)).not.toContain('users-a')
  })

  it('drops a domain that names a node the caller cannot see', async () => {
    rbacScopeMock.mockResolvedValue(nodeScopedToN1)
    const { GET } = await import('./route')
    const body = await readBody(await callRoute(GET as any))

    // {n1} is entirely visible; {n1,n2} names n2, which is not granted.
    expect(body.balancing_domains).toHaveLength(1)
    expect(body.balancing_domains[0].nodes).toEqual(['n1'])
    expect(JSON.stringify(body)).not.toContain('their-node')
  })

  it('leaves an unrestricted caller with everything the tenant owns', async () => {
    rbacScopeMock.mockResolvedValue(null)
    const { GET } = await import('./route')
    const body = await readBody(await callRoute(GET as any))

    expect(body.pinned_guests).toHaveLength(3)
    expect(body.balancing_domains).toHaveLength(3)
  })

  it('drops a domain that names no node at all', async () => {
    rbacScopeMock.mockResolvedValue(null)
    getDRSStatusMock.mockResolvedValue({
      data: { enabled: true, balancing_domains: [{ connection_id: 'mine', nodes: [], guests: 1, spread: 0 }] }
    })
    const { GET } = await import('./route')
    const body = await readBody(await callRoute(GET as any))

    expect(body.balancing_domains).toEqual([])
  })
})
