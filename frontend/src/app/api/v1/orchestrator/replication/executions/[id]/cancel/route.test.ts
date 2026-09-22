import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { callRoute, deniedPermissionResponse } from '@/__tests__/setup/route-test'

const getExecutionMock = vi.fn()
const getRecoveryPlanMock = vi.fn()
const cancelRecoveryExecutionMock = vi.fn()
const checkPermissionMock = vi.fn()

vi.mock('@/lib/orchestrator/client', async importActual => {
  const actual = await importActual<typeof import('@/lib/orchestrator/client')>()

  return {
    ...actual,
    getOrchestratorClient: () => ({
      getExecution: (...args: unknown[]) => getExecutionMock(...args),
      getRecoveryPlan: (...args: unknown[]) => getRecoveryPlanMock(...args),
      cancelRecoveryExecution: (...args: unknown[]) => cancelRecoveryExecutionMock(...args),
    }),
  }
})

vi.mock('@/lib/rbac', () => ({
  checkPermission: (...args: unknown[]) => checkPermissionMock(...args),
  PERMISSIONS: { AUTOMATION_MANAGE: 'automation.manage' },
}))

vi.mock('@/lib/tenant', () => ({
  getTenantConnectionIds: vi.fn().mockResolvedValue(new Set<string>(['conn-src', 'conn-dst'])),
}))

import { POST } from './route'

beforeEach(() => {
  checkPermissionMock.mockReset().mockResolvedValue(null)
  getExecutionMock.mockReset().mockResolvedValue({ data: { id: 'exec-1', plan_id: 'plan-1', status: 'running' } })
  getRecoveryPlanMock.mockReset().mockResolvedValue({ data: { id: 'plan-1', source_cluster: 'conn-src', target_cluster: 'conn-dst' } })
  cancelRecoveryExecutionMock.mockReset().mockResolvedValue({ data: { status: 'cancelling' } })
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/v1/orchestrator/replication/executions/[id]/cancel', () => {
  it('stops a running execution', async () => {
    const res = await callRoute(POST as Parameters<typeof callRoute>[0], { params: { id: 'exec-1' } })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'cancelling' })
    expect(cancelRecoveryExecutionMock).toHaveBeenCalledWith('exec-1')
  })

  it('refuses without automation.manage', async () => {
    checkPermissionMock.mockResolvedValue(deniedPermissionResponse())

    const res = await callRoute(POST as Parameters<typeof callRoute>[0], { params: { id: 'exec-1' } })

    expect(res.status).toBe(403)
    expect(cancelRecoveryExecutionMock).not.toHaveBeenCalled()
  })

  it('404s on an execution whose plan is outside the tenant perimeter', async () => {
    getRecoveryPlanMock.mockResolvedValue({ data: { id: 'plan-1', source_cluster: 'foreign', target_cluster: 'conn-dst' } })

    const res = await callRoute(POST as Parameters<typeof callRoute>[0], { params: { id: 'exec-1' } })

    expect(res.status).toBe(404)
    expect(cancelRecoveryExecutionMock).not.toHaveBeenCalled()
  })

  it('passes on the refusal to abort a failover that is already promoting', async () => {
    // The reason is the whole message: an operator who is told "use failback"
    // knows what to do next, a 500 tells them nothing.
    cancelRecoveryExecutionMock.mockRejectedValue(
      new Error('Orchestrator 409: {"error":"the failover has started promoting guests and can no longer be stopped: use failback to return to the source site"}'),
    )

    const res = await callRoute(POST as Parameters<typeof callRoute>[0], { params: { id: 'exec-1' } })

    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/failback/i)
  })
})
