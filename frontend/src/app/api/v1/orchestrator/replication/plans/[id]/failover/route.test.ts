import { describe, expect, it, vi, beforeEach } from 'vitest'
import { callRoute } from '@/__tests__/setup/route-test'

const getRecoveryPlanMock = vi.fn()
const executeFailoverMock = vi.fn()
const checkPermissionMock = vi.fn()

vi.mock('@/lib/orchestrator/client', () => ({
  getOrchestratorClient: () => ({
    getRecoveryPlan: (...args: unknown[]) => getRecoveryPlanMock(...args),
    executeFailover: (...args: unknown[]) => executeFailoverMock(...args),
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
  name: 'Prod DR',
  source_cluster: 'conn-src',
  target_cluster: 'conn-dst',
}

beforeEach(() => {
  checkPermissionMock.mockReset().mockResolvedValue(null)
  getRecoveryPlanMock.mockReset().mockResolvedValue({ data: fakePlan })
  executeFailoverMock.mockReset().mockResolvedValue({ data: { id: 'exec-1', status: 'running' } })
})

describe('POST /api/v1/orchestrator/replication/plans/[id]/failover', () => {
  it('forwards a restore_points body to client.executeFailover', async () => {
    const restorePoints = { 100: 'snap-1' }
    await callRoute(POST as Parameters<typeof callRoute>[0], {
      params: { id: 'plan-1' },
      body: { restore_points: restorePoints },
    })
    expect(executeFailoverMock).toHaveBeenCalledWith('plan-1', { restore_points: restorePoints })
  })

  it('still succeeds with an empty body, calling executeFailover with undefined', async () => {
    const res = await callRoute(POST as Parameters<typeof callRoute>[0], {
      params: { id: 'plan-1' },
      method: 'POST',
    })
    expect(res.status).toBe(200)
    expect(executeFailoverMock).toHaveBeenCalledWith('plan-1', undefined)
  })
})
