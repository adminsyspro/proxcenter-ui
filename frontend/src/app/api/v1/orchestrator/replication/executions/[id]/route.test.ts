import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { callRoute, deniedPermissionResponse } from '@/__tests__/setup/route-test'

const checkPermissionMock = vi.fn()
const getExecutionMock = vi.fn()
const getRecoveryPlanMock = vi.fn()
const getTenantConnectionIdsMock = vi.fn()

vi.mock('@/lib/rbac', () => ({
  checkPermission: (...args: unknown[]) => checkPermissionMock(...args),
  PERMISSIONS: { AUTOMATION_VIEW: 'automation.view' },
}))

vi.mock('@/lib/tenant', () => ({
  getTenantConnectionIds: () => getTenantConnectionIdsMock(),
}))

vi.mock('@/lib/orchestrator/client', () => ({
  getOrchestratorClient: () => ({
    getExecution: (...args: unknown[]) => getExecutionMock(...args),
    getRecoveryPlan: (...args: unknown[]) => getRecoveryPlanMock(...args),
  }),
}))

import { GET } from './route'

beforeEach(() => {
  checkPermissionMock.mockReset().mockResolvedValue(null)
  getTenantConnectionIdsMock.mockReset().mockResolvedValue(new Set(['conn-src', 'conn-dst']))
  getExecutionMock.mockReset().mockResolvedValue({ data: { id: 'exec-1', plan_id: 'plan-1', status: 'completed' } })
  getRecoveryPlanMock.mockReset().mockResolvedValue({ data: { source_cluster: 'conn-src', target_cluster: 'conn-dst' } })
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/v1/orchestrator/replication/executions/[id]', () => {
  it('returns the denied response when permission is refused', async () => {
    checkPermissionMock.mockResolvedValue(deniedPermissionResponse())

    const res = await callRoute(GET, { params: { id: 'exec-1' } })

    expect(res.status).toBe(403)
    expect(getExecutionMock).not.toHaveBeenCalled()
  })

  it('returns the execution passthrough for an in-tenant execution', async () => {
    const res = await callRoute(GET, { params: { id: 'exec-1' } })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ id: 'exec-1', plan_id: 'plan-1', status: 'completed' })
  })

  it('404s when the execution traces back to a plan outside the tenant scope', async () => {
    getRecoveryPlanMock.mockResolvedValue({ data: { source_cluster: 'foreign', target_cluster: 'conn-dst' } })

    const res = await callRoute(GET, { params: { id: 'exec-1' } })

    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Not found' })
  })

  it('returns a 500 with the error message when the orchestrator call fails', async () => {
    getExecutionMock.mockRejectedValue(new Error('boom'))

    const res = await callRoute(GET, { params: { id: 'exec-1' } })

    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'boom' })
  })

  it('falls back to a generic message when the error has none of its own', async () => {
    getExecutionMock.mockRejectedValue({})

    const res = await callRoute(GET, { params: { id: 'exec-1' } })

    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Failed to fetch execution' })
  })
})
