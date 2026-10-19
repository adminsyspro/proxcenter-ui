import { beforeEach, describe, expect, it, vi } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'
import { connectionScope, guestDerivedScope } from '@/__tests__/setup/rbacScope'

/**
 * #1129: the dashboard's top consumers over a time window. The route merges
 * the per-connection rankings of the orchestrator and applies exactly the
 * visibility of the dashboard route: tenant plan, RBAC candidate connections,
 * vDC pools for iaas, a per-guest RBAC check for a scoped caller.
 */

const { globalFindMany, sessionFindMany, getInfraMock, mockGetServerSession, rbacScopeMock, visibilityMock, getTopGuestsMock } = vi.hoisted(() => ({
  globalFindMany: vi.fn(),
  sessionFindMany: vi.fn(),
  getInfraMock: vi.fn(),
  mockGetServerSession: vi.fn(),
  rbacScopeMock: vi.fn(),
  visibilityMock: vi.fn(),
  getTopGuestsMock: vi.fn(),
}))

// Keep the REAL inventoryConnectionPlan + maskingScope; only the tenant lookup is stubbed.
vi.mock('@/lib/tenant/infraScope', async (orig) => ({
  ...(await orig<typeof import('@/lib/tenant/infraScope')>()),
  getTenantInfrastructureScope: (...a: any[]) => getInfraMock(...a),
}))

vi.mock('@/lib/tenant', () => ({
  getSessionPrisma: async () => ({ connection: { findMany: sessionFindMany } }),
}))

vi.mock('@/lib/db/prisma', () => ({
  prisma: { connection: { findMany: globalFindMany } },
}))

vi.mock('next-auth', () => ({ getServerSession: mockGetServerSession }))
vi.mock('@/lib/auth/config', () => ({ authOptions: {} }))
vi.mock('@/lib/demo/demo-api', () => ({ demoResponse: vi.fn().mockReturnValue(null) }))

vi.mock('@/lib/rbac', () => ({
  getCurrentRbacInfraScope: rbacScopeMock,
  loadGuestVisibilityCheck: (...a: any[]) => visibilityMock(...a),
  PERMISSIONS: { VM_VIEW: 'vm.view', NODE_VIEW: 'node.view' },
}))

vi.mock('@/lib/orchestrator/client', () => ({
  getOrchestratorClient: () => ({
    getTopGuests: (...a: any[]) => getTopGuestsMock(...a),
  }),
}))

const PVE = [
  { id: 'p1', name: 'PVE 1', type: 'pve' },
  { id: 'p2', name: 'PVE 2', type: 'pve' },
  { id: 'pbs-1', name: 'PBS 1', type: 'pbs' },
]

const guest = (vmid: number, name: string, value: number, over: Record<string, unknown> = {}) => ({
  vmid, name, node: 'pve1', type: 'qemu', status: 'running', pool: 'prod', tags: 'db', value, samples: 10, ...over,
})

const payload = (items: unknown[], firstSampleAt: string | null = '2026-10-12T08:00:00Z') => ({
  data: { metric: 'cpu', agg: 'avg', unit: 'percent', from: '', to: '', first_sample_at: firstSampleAt, samples: 60, stride: 1, items },
})

const unavailable = () => Object.assign(new Error('Orchestrator unavailable'), { code: 'ORCHESTRATOR_UNAVAILABLE' })

const get = async (searchParams: Record<string, string> = {}) => {
  const { GET } = await import('./route')
  return callRoute(GET, { method: 'GET', searchParams })
}

beforeEach(() => {
  vi.clearAllMocks()
  globalFindMany.mockResolvedValue(PVE)
  sessionFindMany.mockResolvedValue([])
  getInfraMock.mockResolvedValue({ kind: 'provider' })
  rbacScopeMock.mockResolvedValue(null)
  visibilityMock.mockResolvedValue(() => true)
  mockGetServerSession.mockResolvedValue({ user: { id: 'u1', tenantId: 'default' } })
  getTopGuestsMock.mockResolvedValue(payload([]))
})

describe('GET /api/v1/dashboard/top-consumers', () => {
  it('merges both connections, sorts by value then name, cuts to the limit and never leaks pool or tags', async () => {
    getTopGuestsMock.mockImplementation(async (connId: string) => {
      if (connId === 'p1') return payload([guest(101, 'db01', 90), guest(102, 'web01', 10)], '2026-10-10T00:00:00Z')
      return payload([guest(201, 'app01', 90), ...Array.from({ length: 12 }, (_, i) => guest(300 + i, `batch${i}`, 50 - i))], '2026-10-12T00:00:00Z')
    })

    const res = await get({ metric: 'cpu', agg: 'max', from: '2026-10-19T05:00:00Z', to: '2026-10-19T07:00:00Z', limit: '10' })
    const body = await readJson<any>(res)

    expect(res.status).toBe(200)
    expect(getTopGuestsMock).toHaveBeenCalledTimes(2)
    expect(getTopGuestsMock).toHaveBeenCalledWith('p1', { metric: 'cpu', agg: 'max', from: '2026-10-19T05:00:00.000Z', to: '2026-10-19T07:00:00.000Z', limit: 0 })
    expect(getTopGuestsMock).not.toHaveBeenCalledWith('pbs-1', expect.anything())
    expect(body.items).toHaveLength(10)
    expect(body.items.slice(0, 3).map((i: any) => [i.connection, i.name, i.value])).toEqual([['PVE 2', 'app01', 90], ['PVE 1', 'db01', 90], ['PVE 2', 'batch0', 50]])
    expect(body.items[0]).toEqual({ connId: 'p2', connection: 'PVE 2', vmid: 201, name: 'app01', node: 'pve1', type: 'qemu', status: 'running', value: 90, samples: 10 })
    expect(body.items.some((i: any) => 'pool' in i || 'tags' in i)).toBe(false)
    expect(body.firstSampleAt).toBe('2026-10-10T00:00:00Z')
    expect(body.unit).toBe('percent')
    expect(body.metric).toBe('cpu')
    expect(body.agg).toBe('max')
    // An unrestricted caller is never judged guest by guest.
    expect(visibilityMock).not.toHaveBeenCalled()
  })

  it('restricts an iaas tenant to the guests of its vDC pools and to its vDC connections', async () => {
    getInfraMock.mockResolvedValue({
      kind: 'iaas',
      vdcScope: {
        connectionIds: new Set(['p1']),
        pbsConnectionIds: new Set(),
        nodesByConnection: new Map([['p1', new Set(['pve1'])]]),
        poolsByConnection: new Map([['p1', new Set(['acme'])]]),
      },
    })
    getTopGuestsMock.mockResolvedValue(payload([
      guest(101, 'theirs', 80, { pool: 'acme' }),
      guest(102, 'other-tenant', 95, { pool: 'globex' }),
      guest(103, 'no-pool', 99, { pool: undefined }),
    ]))

    const res = await get({ metric: 'ram' })
    const body = await readJson<any>(res)

    expect(res.status).toBe(200)
    expect(getTopGuestsMock).toHaveBeenCalledTimes(1)
    expect(getTopGuestsMock).toHaveBeenCalledWith('p1', expect.anything())
    expect(body.items.map((i: any) => i.name)).toEqual(['theirs'])
  })

  it('judges every guest with the RBAC predicate for a scoped caller and skips ungranted connections', async () => {
    rbacScopeMock.mockResolvedValue(connectionScope('p1'))
    visibilityMock.mockResolvedValue((g: any) => g.vmid === 101)
    getTopGuestsMock.mockResolvedValue(payload([guest(101, 'granted', 50), guest(102, 'denied', 90)]))

    const res = await get({ metric: 'cpu' })
    const body = await readJson<any>(res)

    expect(rbacScopeMock).toHaveBeenCalledWith(['vm.view', 'node.view'])
    expect(visibilityMock).toHaveBeenCalledWith('u1', 'vm.view', 'default')
    expect(getTopGuestsMock).toHaveBeenCalledTimes(1)
    expect(getTopGuestsMock).toHaveBeenCalledWith('p1', expect.anything())
    expect(body.items.map((i: any) => i.name)).toEqual(['granted'])
  })

  it('keeps a row without type for an unrestricted caller and drops it for a scoped one', async () => {
    const legacy = guest(101, 'old-row', 70, { type: undefined, pool: undefined, tags: undefined })
    getTopGuestsMock.mockResolvedValue(payload([legacy]))

    let body = await readJson<any>(await get({ metric: 'cpu', connections: 'p1' }))
    expect(body.items.map((i: any) => i.name)).toEqual(['old-row'])

    rbacScopeMock.mockResolvedValue(guestDerivedScope())
    // Same answer the real predicate gives a guest with no type.
    visibilityMock.mockResolvedValue((g: any) => Boolean(g.type))
    body = await readJson<any>(await get({ metric: 'cpu', connections: 'p1' }))
    expect(body.items).toEqual([])
    expect(body.available).toBeUndefined()
  })

  it('skips a connection whose call failed and still answers with the others', async () => {
    getTopGuestsMock.mockImplementation(async (connId: string) => {
      if (connId === 'p1') throw new Error('Orchestrator 500: boom')
      return payload([guest(201, 'survivor', 42)])
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const res = await get({ metric: 'netin' })
    const body = await readJson<any>(res)

    expect(res.status).toBe(200)
    expect(body.available).toBeUndefined()
    expect(body.unit).toBe('bytes_per_second')
    expect(body.items.map((i: any) => i.name)).toEqual(['survivor'])
    warn.mockRestore()
  })

  it('answers available:false when every connection finds no orchestrator', async () => {
    getTopGuestsMock.mockRejectedValue(unavailable())

    const res = await get({ metric: 'cpu' })

    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual({ available: false, items: [] })
  })

  it('honours the connections filter and defaults the window to the last hour', async () => {
    const before = Date.now()
    await get({ metric: 'diskwrite', connections: 'p2,unknown' })

    expect(getTopGuestsMock).toHaveBeenCalledTimes(1)
    const [connId, opts] = getTopGuestsMock.mock.calls[0]
    expect(connId).toBe('p2')
    expect(opts.agg).toBe('avg')
    const span = new Date(opts.to).getTime() - new Date(opts.from).getTime()
    expect(span).toBe(60 * 60 * 1000)
    expect(new Date(opts.to).getTime()).toBeGreaterThanOrEqual(before)
  })

  it('refuses an unknown metric or aggregation, a bad date and an inverted window', async () => {
    expect((await get({ metric: 'gpu' })).status).toBe(400)
    expect((await get({ metric: 'cpu', agg: 'p99' })).status).toBe(400)
    expect((await get({ metric: 'cpu', from: 'yesterday' })).status).toBe(400)
    expect((await get({ metric: 'cpu', from: '2026-10-19T07:00:00Z', to: '2026-10-19T05:00:00Z' })).status).toBe(400)
    expect(getTopGuestsMock).not.toHaveBeenCalled()
  })

  it('needs a session', async () => {
    mockGetServerSession.mockResolvedValue(null)

    const res = await get({ metric: 'cpu' })

    expect(res.status).toBe(401)
    expect(getTopGuestsMock).not.toHaveBeenCalled()
  })
})
