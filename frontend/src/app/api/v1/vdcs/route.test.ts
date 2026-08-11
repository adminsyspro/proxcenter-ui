/**
 * Wiring tests for GET /api/v1/vdcs visibility filtering (§3.8a).
 * Run: npx vitest run --config vitest.unit.config.ts src/app/api/v1/vdcs/route.test.ts
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  checkPermissionMock, getRBACContextMock, getAccessibleResourcesMock,
  listVdcsMock, refreshVdcUsageMock, getCurrentTenantIdMock,
} = vi.hoisted(() => ({
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
})

describe('GET /api/v1/vdcs — RBAC visibility', () => {
  it('admin → full list, the grant resolver is never consulted', async () => {
    getRBACContextMock.mockResolvedValue({ userId: 'u1', isAdmin: true, tenantId: 't1' })
    const res = await GET()
    expect((await res.json()).data).toHaveLength(2)
    expect(getAccessibleResourcesMock).not.toHaveBeenCalled()
  })

  it('non-admin with a connection grant → only that vDC', async () => {
    getRBACContextMock.mockResolvedValue({ userId: 'u1', isAdmin: false, tenantId: 't1' })
    getAccessibleResourcesMock.mockResolvedValue([{ scope_type: 'connection', scope_target: 'conn-B' }])
    const res = await GET()
    expect((await res.json()).data).toEqual([vdcB])
  })

  it('grant resolver failure → full list (fail-open, no hiding on errors)', async () => {
    getRBACContextMock.mockResolvedValue({ userId: 'u1', isAdmin: false, tenantId: 't1' })
    getAccessibleResourcesMock.mockRejectedValue(new Error('boom'))
    const res = await GET()
    expect((await res.json()).data).toHaveLength(2)
  })

  it('token principal (no userId on the context) → full list, resolver never consulted', async () => {
    getRBACContextMock.mockResolvedValue({ isAdmin: false, tenantId: 't1', principal: { kind: 'token' } })
    const res = await GET()
    expect((await res.json()).data).toHaveLength(2)
    expect(getAccessibleResourcesMock).not.toHaveBeenCalled()
  })

  it('getRBACContext failure → full list (fail-open), still 200', async () => {
    getRBACContextMock.mockRejectedValue(new Error('principal resolution failed'))
    const res = await GET()
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
    const res = await GET()
    expect(refreshVdcUsageMock).toHaveBeenCalledTimes(1)
    expect(refreshVdcUsageMock).toHaveBeenCalledWith('vB')
    expect(refreshVdcUsageMock).not.toHaveBeenCalledWith('vA')
    expect((await res.json()).data).toEqual([vdcB])
  })
})
