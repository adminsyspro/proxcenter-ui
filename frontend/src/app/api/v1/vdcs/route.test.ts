/**
 * Wiring tests for GET /api/v1/vdcs visibility filtering (§3.8a).
 * Run: npx vitest run --config vitest.unit.config.ts src/app/api/v1/vdcs/route.test.ts
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  checkPermissionMock, getRBACContextMock, getAccessibleResourcesMock,
  listVdcsMock, refreshVdcUsageMock, getCurrentTenantIdMock, resolveScopeTenantMock,
} = vi.hoisted(() => ({
  resolveScopeTenantMock: vi.fn(),
  checkPermissionMock: vi.fn(),
  getRBACContextMock: vi.fn(),
  getAccessibleResourcesMock: vi.fn(),
  listVdcsMock: vi.fn(),
  refreshVdcUsageMock: vi.fn(),
  getCurrentTenantIdMock: vi.fn(),
}))

vi.mock('@/lib/rbac', () => ({
  checkPermission: checkPermissionMock,
  getRBACContext: getRBACContextMock,
  getAccessibleResources: getAccessibleResourcesMock,
  PERMISSIONS: { VM_VIEW: 'vm.view' },
}))
vi.mock('@/lib/vdc', () => ({ listVdcs: listVdcsMock, refreshVdcUsage: refreshVdcUsageMock }))
vi.mock('@/lib/tenant', () => ({ getCurrentTenantId: getCurrentTenantIdMock }))

vi.mock('@/lib/vdc/providerTarget', () => ({ resolveScopeTenant: (...a: any[]) => resolveScopeTenantMock(...a) }))

import { GET } from './route'

const fresh = { lastSyncedAt: new Date().toISOString() }
const vdcA = { id: 'vA', connectionId: 'conn-A', pvePoolName: 'pool-a', nodes: ['n1'], usage: fresh }
const vdcB = { id: 'vB', connectionId: 'conn-B', pvePoolName: 'pool-b', nodes: ['n2'], usage: fresh }

beforeEach(() => {
  vi.clearAllMocks()
  checkPermissionMock.mockResolvedValue(null)
  getCurrentTenantIdMock.mockResolvedValue('t1')
  listVdcsMock.mockResolvedValue([vdcA, vdcB])
  refreshVdcUsageMock.mockResolvedValue(undefined)
  resolveScopeTenantMock.mockImplementation(async (_req: any, _id: any, current: () => Promise<string>) => ({ ok: true, tenantId: await current(), target: null }))
})

describe('GET /api/v1/vdcs — RBAC visibility', () => {
  it('admin → full list, the grant resolver is never consulted', async () => {
    getRBACContextMock.mockResolvedValue({ userId: 'u1', isAdmin: true, tenantId: 't1' })
    const res = await GET(new Request("http://localhost/api/v1/vdcs"))
    expect((await res.json()).data).toHaveLength(2)
    expect(getAccessibleResourcesMock).not.toHaveBeenCalled()
  })

  it('non-admin with a connection grant → only that vDC', async () => {
    getRBACContextMock.mockResolvedValue({ userId: 'u1', isAdmin: false, tenantId: 't1' })
    getAccessibleResourcesMock.mockResolvedValue([{ scope_type: 'connection', scope_target: 'conn-B' }])
    const res = await GET(new Request("http://localhost/api/v1/vdcs"))
    expect((await res.json()).data).toEqual([vdcB])
  })

  it('grant resolver failure → full list (fail-open, no hiding on errors)', async () => {
    getRBACContextMock.mockResolvedValue({ userId: 'u1', isAdmin: false, tenantId: 't1' })
    getAccessibleResourcesMock.mockRejectedValue(new Error('boom'))
    const res = await GET(new Request("http://localhost/api/v1/vdcs"))
    expect((await res.json()).data).toHaveLength(2)
  })

  it('token principal (no userId on the context) → full list, resolver never consulted', async () => {
    getRBACContextMock.mockResolvedValue({ isAdmin: false, tenantId: 't1', principal: { kind: 'token' } })
    const res = await GET(new Request("http://localhost/api/v1/vdcs"))
    expect((await res.json()).data).toHaveLength(2)
    expect(getAccessibleResourcesMock).not.toHaveBeenCalled()
  })

  it('getRBACContext failure → full list (fail-open), still 200', async () => {
    getRBACContextMock.mockRejectedValue(new Error('principal resolution failed'))
    const res = await GET(new Request("http://localhost/api/v1/vdcs"))
    expect(res.status).toBe(200)
    expect((await res.json()).data).toHaveLength(2)
  })

  it('stale usage → refresh only the VISIBLE vDCs and re-filter the refetched list', async () => {
    getRBACContextMock.mockResolvedValue({ userId: 'u1', isAdmin: false, tenantId: 't1' })
    getAccessibleResourcesMock.mockResolvedValue([{ scope_type: 'connection', scope_target: 'conn-B' }])
    const staleA = { ...vdcA, usage: null }
    const staleB = { ...vdcB, usage: null }
    listVdcsMock
      .mockResolvedValueOnce([staleA, staleB]) // both stale — only the VISIBLE one may be refreshed
      .mockResolvedValueOnce([vdcA, vdcB])     // refetch après refresh
    const res = await GET(new Request("http://localhost/api/v1/vdcs"))
    expect(refreshVdcUsageMock).toHaveBeenCalledTimes(1)
    expect(refreshVdcUsageMock).toHaveBeenCalledWith('vB')
    expect(refreshVdcUsageMock).not.toHaveBeenCalledWith('vA')
    expect((await res.json()).data).toEqual([vdcB])
  })
})

describe('GET /api/v1/vdcs: provider target (roadmap#65)', () => {
  const target = { vdcId: 'vB', tenantId: 't-acme', connectionId: 'conn-B' }
  const url = 'http://localhost/api/v1/vdcs?targetVdcId=vB'

  beforeEach(() => {
    resolveScopeTenantMock.mockResolvedValue({ ok: true, tenantId: 't-acme', target })
  })

  it('returns only the target vDC of the target tenant, without the visibility filter', async () => {
    const res = await GET(new Request(url))
    expect((await res.json()).data).toEqual([vdcB])
    expect(listVdcsMock).toHaveBeenCalledWith('t-acme')
    expect(getRBACContextMock).not.toHaveBeenCalled()
    expect(refreshVdcUsageMock).not.toHaveBeenCalled()
  })

  it('refreshes a stale usage of the target vDC and returns the refetched row', async () => {
    const stale = { ...vdcB, usage: null }
    const refreshed = { ...vdcB, usage: { lastSyncedAt: new Date().toISOString(), cores: 2 } }
    listVdcsMock.mockResolvedValueOnce([vdcA, stale]).mockResolvedValueOnce([vdcA, refreshed])
    const res = await GET(new Request(url))
    expect(refreshVdcUsageMock).toHaveBeenCalledTimes(1)
    expect(refreshVdcUsageMock).toHaveBeenCalledWith('vB')
    expect((await res.json()).data).toEqual([refreshed])
  })

  it('still answers when the usage refresh fails', async () => {
    listVdcsMock.mockResolvedValue([{ ...vdcB, usage: null }])
    refreshVdcUsageMock.mockRejectedValue(new Error('pve down'))
    const res = await GET(new Request(url))
    expect(res.status).toBe(200)
    expect((await res.json()).data).toHaveLength(1)
  })

  it('returns an empty list when the target vDC is not among the tenant vDCs', async () => {
    listVdcsMock.mockResolvedValue([vdcA])
    const res = await GET(new Request(url))
    expect((await res.json()).data).toEqual([])
    expect(refreshVdcUsageMock).not.toHaveBeenCalled()
  })

  it('propagates the refusal of the guard', async () => {
    resolveScopeTenantMock.mockResolvedValue({ ok: false, response: Response.json({ error: 'nope' }, { status: 403 }) })
    const res = await GET(new Request(url))
    expect(res.status).toBe(403)
    expect(listVdcsMock).not.toHaveBeenCalled()
  })
})
