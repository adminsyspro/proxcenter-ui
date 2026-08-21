import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { callRoute, deniedPermissionResponse } from '@/__tests__/setup/route-test'

const getRecoveryPlanMock = vi.fn()
const testFailoverMock = vi.fn()
const checkPermissionMock = vi.fn()

vi.mock('@/lib/orchestrator/client', () => ({
  getOrchestratorClient: () => ({
    getRecoveryPlan: (...args: unknown[]) => getRecoveryPlanMock(...args),
    testFailover: (...args: unknown[]) => testFailoverMock(...args),
  }),
}))

vi.mock('@/lib/rbac', () => ({
  checkPermission: (...args: unknown[]) => checkPermissionMock(...args),
  PERMISSIONS: {
    AUTOMATION_VIEW: 'automation.view',
    AUTOMATION_MANAGE: 'automation.manage',
  },
}))

vi.mock('@/lib/tenant', () => ({
  getTenantConnectionIds: vi.fn().mockResolvedValue(new Set<string>(['conn-src', 'conn-dst'])),
}))

import { POST } from './route'

const fakePlan = {
  id: 'plan-1',
  source_cluster: 'conn-src',
  target_cluster: 'conn-dst',
}

beforeEach(() => {
  checkPermissionMock.mockReset().mockResolvedValue(null)
  getRecoveryPlanMock.mockReset().mockResolvedValue({ data: fakePlan })
  testFailoverMock.mockReset().mockResolvedValue({ data: { id: 'exec-1', status: 'running' } })
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/v1/orchestrator/replication/plans/[id]/test-failover', () => {
  it('returns the denied response when permission is refused', async () => {
    checkPermissionMock.mockResolvedValue(deniedPermissionResponse())

    const res = await callRoute(POST as Parameters<typeof callRoute>[0], { params: { id: 'plan-1' } })

    expect(res.status).toBe(403)
    expect(testFailoverMock).not.toHaveBeenCalled()
  })

  it('404s when the plan belongs to another tenant', async () => {
    getRecoveryPlanMock.mockResolvedValue({ data: { ...fakePlan, source_cluster: 'foreign' } })

    const res = await callRoute(POST as Parameters<typeof callRoute>[0], { params: { id: 'plan-1' } })

    expect(res.status).toBe(404)
    expect(testFailoverMock).not.toHaveBeenCalled()
  })

  it('forwards a restore_points body to client.testFailover', async () => {
    const restorePoints = { 100: 'snap-1' }

    await callRoute(POST as Parameters<typeof callRoute>[0], {
      params: { id: 'plan-1' },
      body: { restore_points: restorePoints },
    })

    expect(testFailoverMock).toHaveBeenCalledWith('plan-1', { restore_points: restorePoints })
  })

  it('forwards network_isolated and screenshot_delay_seconds to client.testFailover', async () => {
    await callRoute(POST as Parameters<typeof callRoute>[0], {
      params: { id: 'plan-1' },
      body: { network_isolated: false, screenshot_delay_seconds: 180 },
    })

    expect(testFailoverMock).toHaveBeenCalledWith('plan-1', { network_isolated: false, screenshot_delay_seconds: 180 })
  })

  it('still succeeds with an empty body, calling testFailover with undefined', async () => {
    const res = await callRoute(POST as Parameters<typeof callRoute>[0], {
      params: { id: 'plan-1' },
      method: 'POST',
    })

    expect(res.status).toBe(200)
    expect(testFailoverMock).toHaveBeenCalledWith('plan-1', undefined)
  })

  it('returns a 500 with the error message when the orchestrator call fails', async () => {
    testFailoverMock.mockRejectedValue(new Error('boom'))

    const res = await callRoute(POST as Parameters<typeof callRoute>[0], { params: { id: 'plan-1' } })

    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'boom' })
  })
})
