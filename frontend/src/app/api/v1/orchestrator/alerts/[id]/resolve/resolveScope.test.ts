/**
 * POST /api/v1/orchestrator/alerts/[id]/resolve — object route: the
 * visibility verdict must resolve the full tenant UNION (ignoreVdcContext),
 * so resolving a deep-linked alert of another vDC works in any view
 * context, while an alert outside the tenant remains a 404.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { callRoute } from '@/__tests__/setup/route-test'

const getAlertMock = vi.fn()
const resolveMock = vi.fn()
const isAlertVisibleToTenantMock = vi.fn()
const getInfraMock = vi.fn()
const vdcVmidsMock = vi.fn()

vi.mock('@/lib/orchestrator/client', () => ({
  alertsApi: {
    getAlert: (...args: unknown[]) => getAlertMock(...args),
    resolve: (...args: unknown[]) => resolveMock(...args),
  },
}))

vi.mock('@/lib/demo/demo-api', () => ({ demoResponse: () => null }))

vi.mock('@/lib/tenant', () => ({
  getCurrentTenantId: vi.fn().mockResolvedValue('tenant-a'),
  getTenantConnectionIds: vi.fn().mockResolvedValue(new Set<string>(['conn-1'])),
}))

vi.mock('@/lib/tenant/infraScope', async (orig) => ({
  ...(await orig<typeof import('@/lib/tenant/infraScope')>()),
  getTenantInfrastructureScope: (...args: unknown[]) => getInfraMock(...args),
}))

vi.mock('@/lib/rbac', () => ({
  checkPermission: vi.fn().mockResolvedValue(null),
  PERMISSIONS: { ALERTS_MANAGE: 'alerts.manage' },
}))

vi.mock('@/lib/alerts/visibility', () => ({
  isAlertVisibleToTenant: (...args: unknown[]) => isAlertVisibleToTenantMock(...args),
}))

vi.mock('@/lib/alerts/vdcVmids', () => ({
  getVdcVmidsByConnection: (...args: unknown[]) => vdcVmidsMock(...args),
}))

import { POST } from './route'

beforeEach(() => {
  vi.clearAllMocks()
  getAlertMock.mockResolvedValue({ data: { id: 'alert-abc', connection_id: 'conn-1' } })
  resolveMock.mockResolvedValue({ data: { status: 'resolved' } })
  isAlertVisibleToTenantMock.mockResolvedValue(true)
  getInfraMock.mockResolvedValue({ kind: 'iaas', vdcScope: { connectionIds: new Set(['conn-1']) } })
  vdcVmidsMock.mockResolvedValue(new Map())
})

describe('POST /api/v1/orchestrator/alerts/[id]/resolve', () => {
  it('resolves a visible alert and resolves the UNION scope', async () => {
    const res = await callRoute(POST as Parameters<typeof callRoute>[0], {
      method: 'POST',
      params: { id: 'alert-abc' },
    })

    expect(res.status).toBe(200)
    expect(resolveMock).toHaveBeenCalledWith('alert-abc')
    // Object route: both scope resolvers must opt out of the view context.
    expect(getInfraMock).toHaveBeenCalledWith('tenant-a', { ignoreVdcContext: true })
    expect(vdcVmidsMock).toHaveBeenCalledWith('tenant-a', { ignoreVdcContext: true })
  })

  it('404s an alert that is not visible to the tenant, without resolving it', async () => {
    isAlertVisibleToTenantMock.mockResolvedValue(false)

    const res = await callRoute(POST as Parameters<typeof callRoute>[0], {
      method: 'POST',
      params: { id: 'alert-foreign' },
    })

    expect(res.status).toBe(404)
    expect(resolveMock).not.toHaveBeenCalled()
  })

  it('skips the VMID map when the caller has no vDC scope', async () => {
    getInfraMock.mockResolvedValue({ kind: 'msp', connectionIds: new Set(['conn-1']) })

    const res = await callRoute(POST as Parameters<typeof callRoute>[0], {
      method: 'POST',
      params: { id: 'alert-abc' },
    })

    expect(res.status).toBe(200)
    expect(vdcVmidsMock).not.toHaveBeenCalled()
  })

  it('500s with the orchestrator error message on failure', async () => {
    resolveMock.mockRejectedValue(new Error('orchestrator down'))

    const res = await callRoute(POST as Parameters<typeof callRoute>[0], {
      method: 'POST',
      params: { id: 'alert-abc' },
    })

    expect(res.status).toBe(500)
    expect((await res.json()).error).toBe('orchestrator down')
  })
})
