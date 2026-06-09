/**
 * Scope-specific tests for GET /api/v1/orchestrator/alerts.
 * Verifies that the route resolves infraKind via getTenantInfrastructureScope
 * and passes it (along with vdcScope=null for provider/msp) into the
 * isAlertVisibleToTenant ctx.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

const getAlertsMock = vi.fn()
const isAlertVisibleToTenantMock = vi.fn()
const getTenantInfrastructureScopeMock = vi.fn()
const maskingScopeMock = vi.fn()

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
    alertSilence: {
      findMany: vi.fn().mockResolvedValue([]),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
  }),
}))

vi.mock('@/lib/tenant/infraScope', () => ({
  getTenantInfrastructureScope: (...args: unknown[]) => getTenantInfrastructureScopeMock(...args),
  maskingScope: (...args: unknown[]) => maskingScopeMock(...args),
}))

vi.mock('@/lib/rbac', () => ({
  checkPermission: vi.fn().mockResolvedValue(null),
  PERMISSIONS: { CONNECTION_VIEW: 'connection.view' },
}))

vi.mock('@/lib/alerts/visibility', () => ({
  isAlertVisibleToTenant: (...args: unknown[]) => isAlertVisibleToTenantMock(...args),
}))

vi.mock('@/lib/alerts/vdcVmids', () => ({
  getVdcVmidsByConnection: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/alerts/orchestratorFingerprint', () => ({
  buildOrchestratorFingerprint: (a: { connection_id?: string; type?: string; resource?: string }) =>
    `${a.connection_id}:${a.type}:${a.resource}`,
}))

import { GET } from './route'

function makeReq() {
  return new Request('http://localhost/api/v1/orchestrator/alerts')
}

beforeEach(() => {
  getAlertsMock.mockReset()
  isAlertVisibleToTenantMock.mockReset()
  getTenantInfrastructureScopeMock.mockReset()
  maskingScopeMock.mockReset()
  isAlertVisibleToTenantMock.mockResolvedValue(true)
})

const alert1 = {
  connection_id: 'conn-1',
  type: 'cpu',
  severity: 'warning',
  resource_type: 'node',
  resource: 'pve-node-1',
  status: 'active',
  last_seen_at: '2026-01-01T00:00:00Z',
}

describe('GET /api/v1/orchestrator/alerts — infraKind forwarding', () => {
  it('passes infraKind:provider and vdcScope:null when tenant is provider', async () => {
    getTenantInfrastructureScopeMock.mockResolvedValue({ kind: 'provider' })
    maskingScopeMock.mockReturnValue(null)
    getAlertsMock.mockResolvedValue({ data: { data: [alert1] } })

    let capturedCtx: any
    isAlertVisibleToTenantMock.mockImplementation((_alert: unknown, ctx: unknown) => {
      capturedCtx = ctx
      return Promise.resolve(true)
    })

    const res = await GET(makeReq())
    expect(res.status).toBe(200)
    expect(capturedCtx).toBeDefined()
    expect(capturedCtx.infraKind).toBe('provider')
    expect(capturedCtx.vdcScope).toBeNull()
  })

  it('passes infraKind:msp and vdcScope:null when tenant is msp', async () => {
    getTenantInfrastructureScopeMock.mockResolvedValue({
      kind: 'msp',
      connectionIds: new Set(['conn-1']),
    })
    maskingScopeMock.mockReturnValue(null)
    getAlertsMock.mockResolvedValue({ data: { data: [alert1] } })

    let capturedCtx: any
    isAlertVisibleToTenantMock.mockImplementation((_alert: unknown, ctx: unknown) => {
      capturedCtx = ctx
      return Promise.resolve(true)
    })

    const res = await GET(makeReq())
    expect(res.status).toBe(200)
    expect(capturedCtx.infraKind).toBe('msp')
    expect(capturedCtx.vdcScope).toBeNull()
  })

  it('passes infraKind:iaas and non-null vdcScope when tenant is iaas', async () => {
    const fakeVdcScope = { connectionIds: new Set(['conn-1']), vmids: new Set<string>() }
    getTenantInfrastructureScopeMock.mockResolvedValue({
      kind: 'iaas',
      vdcScope: fakeVdcScope,
    })
    maskingScopeMock.mockReturnValue(fakeVdcScope)
    getAlertsMock.mockResolvedValue({ data: { data: [alert1] } })

    let capturedCtx: any
    isAlertVisibleToTenantMock.mockImplementation((_alert: unknown, ctx: unknown) => {
      capturedCtx = ctx
      return Promise.resolve(true)
    })

    // For iaas, vdcVmids would be fetched (vdcScope is non-null).
    // The mock for getVdcVmidsByConnection returns undefined — acceptable here.
    const res = await GET(makeReq())
    expect(res.status).toBe(200)
    expect(capturedCtx.infraKind).toBe('iaas')
    expect(capturedCtx.vdcScope).toBe(fakeVdcScope)
  })

  it('returns empty list when no alerts pass visibility for provider', async () => {
    getTenantInfrastructureScopeMock.mockResolvedValue({ kind: 'provider' })
    maskingScopeMock.mockReturnValue(null)
    getAlertsMock.mockResolvedValue({ data: { data: [alert1] } })
    isAlertVisibleToTenantMock.mockResolvedValue(false)

    const res = await GET(makeReq())
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.data).toHaveLength(0)
  })
})
