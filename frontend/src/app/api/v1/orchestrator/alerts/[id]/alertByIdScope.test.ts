/**
 * Scope-specific tests for GET + DELETE /api/v1/orchestrator/alerts/[id].
 * Verifies that each handler resolves infraKind via getTenantInfrastructureScope
 * and passes it into the isAlertVisibleToTenant ctx.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { callRoute } from '@/__tests__/setup/route-test'

const getAlertMock = vi.fn()
const deleteAlertMock = vi.fn()
const isAlertVisibleToTenantMock = vi.fn()
const getTenantInfrastructureScopeMock = vi.fn()
const maskingScopeMock = vi.fn()
const { rbacScopeMock } = vi.hoisted(() => ({ rbacScopeMock: vi.fn() }))

import { FAKE_RBAC_SCOPE, forwardedRbacScope } from '@/__tests__/setup/rbacScope'

vi.mock('@/lib/orchestrator/client', () => ({
  alertsApi: {
    getAlert: (...args: unknown[]) => getAlertMock(...args),
    deleteAlert: (...args: unknown[]) => deleteAlertMock(...args),
  },
}))

vi.mock('@/lib/demo/demo-api', () => ({
  demoResponse: () => null,
}))

vi.mock('@/lib/tenant', () => ({
  getCurrentTenantId: vi.fn().mockResolvedValue('default'),
  getTenantConnectionIds: vi.fn().mockResolvedValue(new Set<string>(['conn-1'])),
}))

vi.mock('@/lib/tenant/infraScope', () => ({
  getTenantInfrastructureScope: (...args: unknown[]) => getTenantInfrastructureScopeMock(...args),
  maskingScope: (...args: unknown[]) => maskingScopeMock(...args),
}))

vi.mock('@/lib/rbac', () => ({
  checkPermission: vi.fn().mockResolvedValue(null),
  getCurrentRbacInfraScope: (...args: unknown[]) => rbacScopeMock(...args),
  PERMISSIONS: {
    ALERTS_VIEW: 'alerts.view',
    ALERTS_MANAGE: 'alerts.manage',
  },
}))

vi.mock('@/lib/alerts/visibility', () => ({
  isAlertVisibleToTenant: (...args: unknown[]) => isAlertVisibleToTenantMock(...args),
}))

vi.mock('@/lib/alerts/vdcVmids', () => ({
  getVdcVmidsByConnection: vi.fn().mockResolvedValue(undefined),
}))

import { GET, DELETE } from './route'

const fakeAlert = {
  id: 'alert-abc',
  connection_id: 'conn-1',
  type: 'cpu',
  severity: 'warning',
  resource_type: 'node',
  resource: 'pve-node-1',
  status: 'active',
}

beforeEach(() => {
  getAlertMock.mockReset().mockResolvedValue({ data: fakeAlert })
  deleteAlertMock.mockReset().mockResolvedValue({ data: { ok: true } })
  isAlertVisibleToTenantMock.mockReset().mockResolvedValue(true)
  getTenantInfrastructureScopeMock.mockReset()
  maskingScopeMock.mockReset().mockReturnValue(null)
  rbacScopeMock.mockReset().mockResolvedValue(null)
})

describe('GET /api/v1/orchestrator/alerts/[id] — infraKind forwarding', () => {
  it('passes infraKind:provider and vdcScope:null for a provider tenant', async () => {
    getTenantInfrastructureScopeMock.mockResolvedValue({ kind: 'provider' })

    let capturedCtx: any
    isAlertVisibleToTenantMock.mockImplementation((_alert: unknown, ctx: unknown) => {
      capturedCtx = ctx
      return Promise.resolve(true)
    })

    const res = await callRoute(GET as Parameters<typeof callRoute>[0], {
      params: { id: 'alert-abc' },
    })
    expect(res.status).toBe(200)
    expect(capturedCtx.infraKind).toBe('provider')
    expect(capturedCtx.vdcScope).toBeNull()
  })

  it('passes infraKind:msp and vdcScope:null for an msp tenant', async () => {
    getTenantInfrastructureScopeMock.mockResolvedValue({
      kind: 'msp',
      connectionIds: new Set(['conn-1']),
    })

    let capturedCtx: any
    isAlertVisibleToTenantMock.mockImplementation((_alert: unknown, ctx: unknown) => {
      capturedCtx = ctx
      return Promise.resolve(true)
    })

    const res = await callRoute(GET as Parameters<typeof callRoute>[0], {
      params: { id: 'alert-abc' },
    })
    expect(res.status).toBe(200)
    expect(capturedCtx.infraKind).toBe('msp')
    expect(capturedCtx.vdcScope).toBeNull()
  })

  it('returns 404 when alert is not visible to the tenant', async () => {
    getTenantInfrastructureScopeMock.mockResolvedValue({ kind: 'provider' })
    isAlertVisibleToTenantMock.mockResolvedValue(false)

    const res = await callRoute(GET as Parameters<typeof callRoute>[0], {
      params: { id: 'alert-abc' },
    })
    expect(res.status).toBe(404)
  })
})

describe('DELETE /api/v1/orchestrator/alerts/[id] — infraKind forwarding', () => {
  it('passes infraKind:provider and vdcScope:null for a provider tenant', async () => {
    getTenantInfrastructureScopeMock.mockResolvedValue({ kind: 'provider' })

    let capturedCtx: any
    isAlertVisibleToTenantMock.mockImplementation((_alert: unknown, ctx: unknown) => {
      capturedCtx = ctx
      return Promise.resolve(true)
    })

    const res = await callRoute(DELETE as Parameters<typeof callRoute>[0], {
      params: { id: 'alert-abc' },
      method: 'DELETE',
    })
    expect(res.status).toBe(200)
    expect(capturedCtx.infraKind).toBe('provider')
    expect(capturedCtx.vdcScope).toBeNull()
  })

  it('passes infraKind:msp and vdcScope:null for an msp tenant', async () => {
    getTenantInfrastructureScopeMock.mockResolvedValue({
      kind: 'msp',
      connectionIds: new Set(['conn-1']),
    })

    let capturedCtx: any
    isAlertVisibleToTenantMock.mockImplementation((_alert: unknown, ctx: unknown) => {
      capturedCtx = ctx
      return Promise.resolve(true)
    })

    const res = await callRoute(DELETE as Parameters<typeof callRoute>[0], {
      params: { id: 'alert-abc' },
      method: 'DELETE',
    })
    expect(res.status).toBe(200)
    expect(capturedCtx.infraKind).toBe('msp')
    expect(capturedCtx.vdcScope).toBeNull()
  })

  it('returns 404 on DELETE when alert is not visible to the tenant', async () => {
    getTenantInfrastructureScopeMock.mockResolvedValue({ kind: 'provider' })
    isAlertVisibleToTenantMock.mockResolvedValue(false)

    const res = await callRoute(DELETE as Parameters<typeof callRoute>[0], {
      params: { id: 'alert-abc' },
      method: 'DELETE',
    })
    expect(res.status).toBe(404)
  })
})

describe('RBAC infra scope forwarding (issue #525)', () => {
  beforeEach(() => {
    getTenantInfrastructureScopeMock.mockResolvedValue({ kind: 'provider' })
  })

  it('GET forwards the caller scope, null when unrestricted', async () => {
    const byIdRes = await callRoute(GET as Parameters<typeof callRoute>[0], { params: { id: 'alert-abc' } })
    expect(byIdRes.status).toBe(200)
    expect(forwardedRbacScope(isAlertVisibleToTenantMock)).toBeNull()

    rbacScopeMock.mockResolvedValue(FAKE_RBAC_SCOPE)
    isAlertVisibleToTenantMock.mockClear()
    await callRoute(GET as Parameters<typeof callRoute>[0], { params: { id: 'alert-abc' } })
    expect(forwardedRbacScope(isAlertVisibleToTenantMock)).toBe(FAKE_RBAC_SCOPE)
    expect(rbacScopeMock).toHaveBeenCalledWith('alerts.view')
  })

  it('DELETE forwards the caller scope before deleting', async () => {
    rbacScopeMock.mockResolvedValue(FAKE_RBAC_SCOPE)
    const deleteRes = await callRoute(DELETE as Parameters<typeof callRoute>[0], {
      params: { id: 'alert-abc' },
      method: 'DELETE',
    })
    expect(deleteRes.status).toBe(200)
    expect(forwardedRbacScope(isAlertVisibleToTenantMock)).toBe(FAKE_RBAC_SCOPE)
    expect(rbacScopeMock).toHaveBeenCalledWith('alerts.manage')
    expect(deleteAlertMock).toHaveBeenCalledWith('alert-abc')
  })
})
