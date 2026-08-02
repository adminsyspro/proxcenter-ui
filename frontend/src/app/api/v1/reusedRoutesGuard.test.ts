/**
 * Task 18: wiring the public-API guard onto the four reused routes
 * (vms, storage, inventory; pbs backups has its own file since it needs no
 * rewiring beyond the export). Two properties per route:
 *
 *  - hard gate 1 + 3: a token principal reaches REAL data restricted to its
 *    own connection perimeter, never an empty list and never a connection
 *    outside its scope. `filterVmsByPermission`, `getRbacInfraScope` and
 *    `filterNodesByPermission` are kept REAL (not mocked) wherever possible:
 *    their token branches are pure (no DB), so this is production code
 *    exercising a token principal, not a stand-in for it.
 *  - session invariance: a session (or absent) principal never reaches
 *    `restrictToTokenScope`'s restriction — the pre-existing route test
 *    files (vmsScope.test.ts, storage/route.test.ts, inventoryScope.test.ts)
 *    are the proof that today's assertions are unchanged; this file adds
 *    only the token-side properties they never had a principal to exercise.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

import type { Principal } from '@/lib/auth/principal'

const {
  checkPermissionMock, getRBACContextMock, getTenantInfrastructureScopeMock,
  getSessionPrismaMock, getCurrentTenantIdMock, getConnectionByIdMock, pveFetchMock,
  demoResponseMock, getInventorySWRMock, restrictToTokenScopeMock, resolveVisibleConnectionIdsMock,
  canReadFleetStorageMock, globalConnectionFindManyMock, currentPrincipal,
} = vi.hoisted(() => ({
  checkPermissionMock: vi.fn<(...a: any[]) => Promise<Response | null>>(),
  getRBACContextMock: vi.fn<() => Promise<any>>(),
  getTenantInfrastructureScopeMock: vi.fn<(...a: any[]) => Promise<any>>(),
  getSessionPrismaMock: vi.fn<() => Promise<any>>(),
  getCurrentTenantIdMock: vi.fn<() => Promise<string>>(),
  getConnectionByIdMock: vi.fn<(...a: any[]) => Promise<any>>(),
  pveFetchMock: vi.fn<(...a: any[]) => Promise<any>>(),
  demoResponseMock: vi.fn<(...a: any[]) => Response | null>(),
  getInventorySWRMock: vi.fn<(...a: any[]) => Promise<any>>(),
  restrictToTokenScopeMock: vi.fn<(connections: any[], principal?: any) => Promise<any[]>>(),
  resolveVisibleConnectionIdsMock: vi.fn<(principal: any) => Promise<Set<string>>>(),
  canReadFleetStorageMock: vi.fn<() => Promise<boolean>>(),
  globalConnectionFindManyMock: vi.fn<(...a: any[]) => Promise<any[]>>(),
  currentPrincipal: { value: undefined as Principal | undefined },
}))

// The guard itself is unit-tested in routeGuard.test.ts; here it stays a
// pass-through that injects the principal under test, exactly the shape the
// REAL guard hands the handler (session callers never get one at all).
vi.mock('@/lib/api-tokens/routeGuard', () => ({
  withPublicApiGuard: (_entryId: string, handler: any) => (req: Request, ctx: any) =>
    handler(req, { ...(ctx || {}), principal: currentPrincipal.value }),
}))

vi.mock('@/lib/api-tokens/scope', () => ({
  restrictToTokenScope: restrictToTokenScopeMock,
  resolveVisibleConnectionIds: resolveVisibleConnectionIdsMock,
}))

// Everything else in @/lib/rbac stays REAL: filterVmsByPermission,
// filterNodesByPermission and getRbacInfraScope all have a token branch
// that touches zero DB (spec section 6), so exercising them for real with a
// token Principal is authentic production behaviour, not a stand-in.
vi.mock('@/lib/rbac', async (orig) => {
  const real = await orig<typeof import('@/lib/rbac')>()
  return {
    ...real,
    checkPermission: checkPermissionMock,
    getRBACContext: getRBACContextMock,
  }
})

vi.mock('@/lib/tenant', () => ({
  getSessionPrisma: getSessionPrismaMock,
  getCurrentTenantId: getCurrentTenantIdMock,
  DEFAULT_TENANT_ID: 'default',
}))

vi.mock('@/lib/tenant/infraScope', async (orig) => ({
  ...(await orig<typeof import('@/lib/tenant/infraScope')>()),
  getTenantInfrastructureScope: getTenantInfrastructureScopeMock,
}))

vi.mock('@/lib/connections/getConnection', () => ({
  getConnectionById: getConnectionByIdMock,
}))

vi.mock('@/lib/proxmox/client', () => ({ pveFetch: pveFetchMock }))

vi.mock('@/lib/inventory/vmConfig', () => ({
  enrichVmsWithConfig: async (_conn: any, mapped: any[]) => mapped,
}))

vi.mock('@/lib/demo/demo-api', () => ({ demoResponse: demoResponseMock }))

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    connection: { findMany: globalConnectionFindManyMock },
    tenant: { findMany: vi.fn() },
    vdc: { findMany: vi.fn() },
  },
}))

vi.mock('@/lib/storage/fleetScope', () => ({ canReadFleetStorage: canReadFleetStorageMock }))

vi.mock('@/lib/inventory/fetchRawInventory', () => ({ getInventorySWR: getInventorySWRMock }))

import { callRoute, readJson } from '@/__tests__/setup/route-test'

const TOKEN_PRINCIPAL: Principal = {
  kind: 'token',
  tokenId: 'tok_1',
  tenantId: 'default',
  permissions: new Set(['vm.view', 'storage.view', 'node.view']),
  connectionIds: ['conn-1'],
  scopes: ['vms:read', 'storage:read', 'nodes:read'],
}

beforeEach(() => {
  vi.clearAllMocks()
  currentPrincipal.value = undefined
  checkPermissionMock.mockResolvedValue(null)
  getTenantInfrastructureScopeMock.mockResolvedValue({ kind: 'provider' })
  getCurrentTenantIdMock.mockResolvedValue('default')
  demoResponseMock.mockReturnValue(null)
  canReadFleetStorageMock.mockResolvedValue(false)
  globalConnectionFindManyMock.mockResolvedValue([])
  resolveVisibleConnectionIdsMock.mockResolvedValue(new Set(['conn-1']))
  // Real-ish behaviour: a session/absent principal is untouched (matches
  // the REAL restrictToTokenScope/withPublicApiGuard contract exactly), a
  // token principal is narrowed by resolveVisibleConnectionIds. If the route
  // ever stopped passing ctx.principal through, this mock would silently
  // keep returning everything -- which is exactly why the "restricts the
  // fan-out" tests below assert on getConnectionById call counts too, not
  // just on this mock having been invoked.
  restrictToTokenScopeMock.mockImplementation(async (connections: any[], principal: any) => {
    if (!principal || principal.kind !== 'token') return connections
    const visible = await resolveVisibleConnectionIdsMock(principal)
    return connections.filter((c: any) => visible.has(c.id))
  })
})

describe('GET /api/v1/vms under a token principal', () => {
  const CONNECTIONS = [
    { id: 'conn-1', name: 'One', tenantId: 'default' },
    { id: 'conn-2', name: 'Two', tenantId: 'default' },
  ]

  beforeEach(() => {
    // infra.kind === 'provider' (module-level default) routes vms/route.ts
    // to the GLOBAL prisma client, not getSessionPrisma.
    globalConnectionFindManyMock.mockResolvedValue(CONNECTIONS)
    getConnectionByIdMock.mockResolvedValue({ baseUrl: 'https://pve', apiToken: 'x' })
    pveFetchMock.mockImplementation((_conn: any, path: string) => {
      if (path.startsWith('/cluster/resources')) {
        return Promise.resolve([
          { type: 'qemu', node: 'node1', vmid: 100, name: 'web-01', status: 'running', cpu: 0.1, mem: 500, maxmem: 2000, maxdisk: 100000 },
        ])
      }
      if (path === '/nodes') return Promise.resolve([{ node: 'node1', status: 'online' }])
      return Promise.resolve([])
    })
  })

  it('returns REAL, non-empty VM data restricted to the token connection perimeter', async () => {
    currentPrincipal.value = TOKEN_PRINCIPAL
    getRBACContextMock.mockResolvedValue({ isAdmin: false, tenantId: 'default', principal: TOKEN_PRINCIPAL })
    const { GET } = await import('./vms/route')
    const res = await callRoute(GET)
    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body.data.vms).toHaveLength(1)
    expect(body.data.vms[0]).toMatchObject({ connId: 'conn-1', name: 'web-01', vmid: '100' })
    expect(body.data.stats.total).toBe(1)
  })

  it('restricts the connection fan-out itself: conn-2 is never even fetched', async () => {
    currentPrincipal.value = TOKEN_PRINCIPAL
    getRBACContextMock.mockResolvedValue({ isAdmin: false, tenantId: 'default', principal: TOKEN_PRINCIPAL })
    const { GET } = await import('./vms/route')
    await callRoute(GET)
    expect(getConnectionByIdMock).toHaveBeenCalledTimes(1)
    expect(getConnectionByIdMock).toHaveBeenCalledWith('conn-1', 'default')
  })

  it('filterVmsByPermission (real token branch) empties the list when vm.view is missing, no crash', async () => {
    // NOT a test of checkPermission's own out-of-scope 403 -- that gate is
    // mocked to pass in this file's beforeEach, on purpose, so this isolates
    // filterVmsByPermission's OWN token branch. checkPermission's real
    // denial for a token lacking the scope is proven separately, at the
    // layer that owns it: principalAware.test.ts's
    // "denies a permission outside the scopes with the unchanged body".
    const scopedOut = { ...TOKEN_PRINCIPAL, permissions: new Set(['storage.view']) }
    currentPrincipal.value = scopedOut
    getRBACContextMock.mockResolvedValue({ isAdmin: false, tenantId: 'default', principal: scopedOut })
    const { GET } = await import('./vms/route')
    const res = await callRoute(GET)
    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body.data.vms).toEqual([])
  })

  it('session path (no principal): every connection is fetched, restrictToTokenScope is a no-op', async () => {
    getRBACContextMock.mockResolvedValue(null)
    const { GET } = await import('./vms/route')
    await callRoute(GET)
    expect(getConnectionByIdMock).toHaveBeenCalledTimes(2)
    expect(resolveVisibleConnectionIdsMock).not.toHaveBeenCalled()
  })
})

describe('GET /api/v1/storage under a token principal', () => {
  const CONNECTIONS = [
    { id: 'conn-1', name: 'One', tenantId: 'default' },
    { id: 'conn-2', name: 'Two', tenantId: 'default' },
    { id: 'conn-3', name: 'Three', tenantId: 'default' },
  ]

  beforeEach(() => {
    getSessionPrismaMock.mockResolvedValue({ connection: { findMany: async () => CONNECTIONS } })
    getConnectionByIdMock.mockImplementation((id: string) => Promise.resolve({ id }))
    pveFetchMock.mockImplementation((connData: any, path: string) => {
      if (path === '/cluster/resources') {
        return Promise.resolve([
          { type: 'storage', storage: 'local-lvm', node: 'n1', status: 'available', disk: 5, maxdisk: 20 },
        ])
      }
      if (path === '/storage') {
        return Promise.resolve([{ storage: 'local-lvm', type: 'lvmthin', content: 'images', disable: 0 }])
      }
      return Promise.resolve([])
    })
  })

  it('a token owning one of three tenant connections sees REAL data for that one only', async () => {
    currentPrincipal.value = TOKEN_PRINCIPAL
    const { GET } = await import('./storage/route')
    const res = await callRoute(GET)
    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body.connections).toEqual([{ id: 'conn-1', name: 'One', tenantId: 'default' }])
    expect(body.data).toHaveLength(1)
    expect(body.data[0]).toMatchObject({ connId: 'conn-1', storage: 'local-lvm', used: 5, total: 20 })
    // Post-fix: a token principal never even consults canReadFleetStorage
    // (the fleet branch is gated on ctx.principal?.kind !== "token" BEFORE
    // the call, see the dedicated compound-credential test below). Was
    // `.toHaveBeenCalled()` before the fix; flipped, not deleted, so a
    // regression back to always-calling it fails right here too.
    expect(canReadFleetStorageMock).not.toHaveBeenCalled()
  })

  it('a token principal never reaches the fleet branch even if a session would grant it (compound-credential regression)', async () => {
    // Models the scenario the storage-list contract exception documents: a
    // request carrying a live provider super-admin session cookie ALONGSIDE
    // a valid token. Before the fix, canReadFleetStorage() read that
    // session directly, independent of ctx.principal, and would resolve
    // true here regardless of the token's own tenant/scopes.
    currentPrincipal.value = TOKEN_PRINCIPAL
    canReadFleetStorageMock.mockResolvedValue(true)
    const { GET } = await import('./storage/route')
    const res = await callRoute(GET)
    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    // Fleet branch must NOT activate: no installation-wide tenants facet,
    // and the connection list stays the token's own tenant-scoped, then
    // token-perimeter-restricted one (getSessionPrisma + restrictToTokenScope),
    // never globalPrisma's fleet-wide query.
    expect(body.tenants).toBeUndefined()
    expect(body.connections).toEqual([{ id: 'conn-1', name: 'One', tenantId: 'default' }])
    // The load-bearing assertion: canReadFleetStorage must never even be
    // CONSULTED for a token principal, so a stray session cookie riding
    // along cannot influence the branch at all, no matter what it would
    // have resolved to.
    expect(canReadFleetStorageMock).not.toHaveBeenCalled()
  })

  it('never even queries conn-2 or conn-3 for storage data', async () => {
    currentPrincipal.value = TOKEN_PRINCIPAL
    const { GET } = await import('./storage/route')
    await callRoute(GET)
    expect(getConnectionByIdMock).toHaveBeenCalledTimes(1)
    expect(getConnectionByIdMock).toHaveBeenCalledWith('conn-1')
  })

  it('session path (no principal): every tenant connection is enumerated, resolveVisibleConnectionIds untouched', async () => {
    const { GET } = await import('./storage/route')
    const res = await callRoute(GET)
    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body.connections.map((c: any) => c.id)).toEqual(['conn-1', 'conn-2', 'conn-3'])
    expect(resolveVisibleConnectionIdsMock).not.toHaveBeenCalled()
  })
})

// inventory/route.ts reads request.nextUrl -- a plain Request (route-test.ts's
// callRoute) doesn't have that property, so a real NextRequest is required
// here (same reason inventoryScope.test.ts rolls its own callGet).
async function callInventoryGet(handler: any) {
  const req = new NextRequest('http://test.local/api/v1/inventory')
  return handler(req, { params: Promise.resolve({}) })
}

describe('GET /api/v1/inventory under a token principal', () => {
  function rawInventory() {
    return {
      clusters: [
        {
          id: 'conn-1',
          name: 'Cluster One',
          type: 'pve' as const,
          isCluster: false,
          status: 'online' as const,
          nodes: [
            {
              node: 'n1',
              status: 'online',
              guests: [{ vmid: 100, type: 'qemu', status: 'running', name: 'web-01', node: 'n1' }],
            },
          ],
        },
        {
          id: 'conn-2',
          name: 'Cluster Two',
          type: 'pve' as const,
          isCluster: false,
          status: 'online' as const,
          nodes: [
            {
              node: 'n2',
              status: 'online',
              guests: [{ vmid: 200, type: 'qemu', status: 'running', name: 'other-01', node: 'n2' }],
            },
          ],
        },
      ],
      pbsServers: [],
      externalHypervisors: [],
      storages: [],
      stats: {
        totalClusters: 2, totalNodes: 2, totalGuests: 2, onlineNodes: 2, runningGuests: 2,
        totalPbsServers: 0, totalDatastores: 0, totalBackups: 0,
      },
    }
  }

  beforeEach(() => {
    getInventorySWRMock.mockResolvedValue({ raw: rawInventory(), cached: true })
  })

  it('passes the PRINCIPAL to getRbacInfraScope and returns REAL data pruned to the token connection', async () => {
    currentPrincipal.value = TOKEN_PRINCIPAL
    getRBACContextMock.mockResolvedValue({ isAdmin: false, tenantId: 'default', principal: TOKEN_PRINCIPAL })
    const { GET } = await import('./inventory/route')
    const res = await callInventoryGet(GET)
    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body.data.clusters).toHaveLength(1)
    expect(body.data.clusters[0].id).toBe('conn-1')
    // filterVmsByPermission's caller stringifies vmid before filtering
    // (inventory/route.ts), so the surviving guest carries a STRING vmid.
    expect(body.data.clusters[0].nodes[0].guests).toEqual([
      { vmid: '100', type: 'qemu', status: 'running', name: 'web-01', node: 'n1', connId: 'conn-1' },
    ])
    expect(body.data.stats.totalGuests).toBe(1)
  })

  it('an unrestricted token (connectionIds: null) sees the whole tenant tree', async () => {
    const unrestricted = { ...TOKEN_PRINCIPAL, connectionIds: null }
    currentPrincipal.value = unrestricted
    getRBACContextMock.mockResolvedValue({ isAdmin: false, tenantId: 'default', principal: unrestricted })
    const { GET } = await import('./inventory/route')
    const res = await callInventoryGet(GET)
    const body = await readJson<any>(res)
    expect(body.data.clusters.map((c: any) => c.id).sort()).toEqual(['conn-1', 'conn-2'])
  })

  it('session path (no principal, null RBAC context): tree unpruned, exactly today\'s "unauthenticated" behaviour', async () => {
    getRBACContextMock.mockResolvedValue(null)
    const { GET } = await import('./inventory/route')
    const res = await callInventoryGet(GET)
    const body = await readJson<any>(res)
    expect(body.data.clusters).toHaveLength(2)
  })
})
