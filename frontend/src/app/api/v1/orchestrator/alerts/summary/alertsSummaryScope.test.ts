import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  getAlertsMock,
  findManyMock,
  isAlertVisibleToTenantMock,
  getTenantInfrastructureScopeMock,
  maskingScopeMock,
  rbacScopeMock,
} = vi.hoisted(() => ({
  getAlertsMock: vi.fn(),
  findManyMock: vi.fn(),
  isAlertVisibleToTenantMock: vi.fn(),
  getTenantInfrastructureScopeMock: vi.fn(),
  maskingScopeMock: vi.fn(),
  rbacScopeMock: vi.fn(),
}))

import { FAKE_RBAC_SCOPE } from '@/__tests__/setup/rbacScope'

const alert1 = {
  connection_id: 'conn-1',
  type: 'cpu',
  severity: 'warning',
  resource_type: 'node',
  resource: 'pve-node-1',
  status: 'active',
  last_seen_at: '2026-01-01T00:00:00Z',
}

vi.mock('@/lib/orchestrator/client', () => ({
  alertsApi: { getAlerts: (...args: unknown[]) => getAlertsMock(...args) },
}))

vi.mock('@/lib/demo/demo-api', () => ({
  demoResponse: () => null,
}))

vi.mock('@/lib/tenant', () => ({
  getCurrentTenantId: vi.fn().mockResolvedValue('default'),
  getTenantConnectionIds: vi.fn().mockResolvedValue(new Set<string>(['conn-1'])),
  getSessionPrisma: vi.fn().mockResolvedValue({
    alertSilence: { findMany: (...args: unknown[]) => findManyMock(...args) },
  }),
}))

vi.mock('@/lib/tenant/infraScope', () => ({
  getTenantInfrastructureScope: (...args: unknown[]) => getTenantInfrastructureScopeMock(...args),
  maskingScope: (...args: unknown[]) => maskingScopeMock(...args),
}))

vi.mock('@/lib/rbac', () => ({
  checkPermission: vi.fn().mockResolvedValue(null),
  getCurrentRbacInfraScope: (...args: unknown[]) => rbacScopeMock(...args),
  PERMISSIONS: { CONNECTION_VIEW: 'connection.view' },
}))

vi.mock('@/lib/alerts/visibility', () => ({
  isAlertVisibleToTenant: (...args: unknown[]) => isAlertVisibleToTenantMock(...args),
}))

vi.mock('@/lib/alerts/vdcVmids', () => ({
  getVdcVmidsByConnection: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/alerts/orchestratorFingerprint', () => ({
  buildOrchestratorFingerprint: (alert: { connection_id?: string; type?: string; resource?: string }) =>
    `${alert.connection_id}:${alert.type}:${alert.resource}`,
}))

import { GET } from './route'

function makeReq() {
  return new Request('http://localhost/api/v1/orchestrator/alerts/summary')
}

beforeEach(() => {
  getAlertsMock.mockReset().mockResolvedValue({ data: { data: [alert1] } })
  findManyMock.mockReset().mockResolvedValue([])
  isAlertVisibleToTenantMock.mockReset().mockResolvedValue(true)
  getTenantInfrastructureScopeMock.mockReset().mockResolvedValue({ kind: 'provider' })
  maskingScopeMock.mockReset().mockReturnValue(null)
  rbacScopeMock.mockReset().mockResolvedValue(null)
})

describe('RBAC infra scope forwarding (issue #525)', () => {
  it('forwards infraKind and the resolved RBAC scope', async () => {
    rbacScopeMock.mockResolvedValue(FAKE_RBAC_SCOPE)

    const res = await GET(makeReq())
    const ctx = isAlertVisibleToTenantMock.mock.calls[0][1]

    expect(res.status).toBe(200)
    expect(ctx.infraKind).toBe('provider')
    expect(ctx.rbacScope).toBe(FAKE_RBAC_SCOPE)
    expect(rbacScopeMock).toHaveBeenCalledWith('connection.view')
  })

  it('forwards infraKind and null for an unrestricted caller', async () => {
    const res = await GET(makeReq())
    const ctx = isAlertVisibleToTenantMock.mock.calls[0][1]

    expect(res.status).toBe(200)
    expect(ctx.infraKind).toBe('provider')
    expect(ctx.rbacScope).toBeNull()
  })

  it('returns an all-zero summary when the alert is not visible', async () => {
    isAlertVisibleToTenantMock.mockResolvedValue(false)

    const res = await GET(makeReq())
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toEqual({
      total_active: 0,
      critical: 0,
      warning: 0,
      info: 0,
      acknowledged: 0,
      resolved_today: 0,
    })
  })
})
