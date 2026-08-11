import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const getExecutionMock = vi.fn()
const getRecoveryPlanMock = vi.fn()
const getTenantConnectionIdsMock = vi.fn()

vi.mock('@/lib/orchestrator/client', () => ({
  getOrchestratorClient: () => ({
    getExecution: (...args: unknown[]) => getExecutionMock(...args),
    getRecoveryPlan: (...args: unknown[]) => getRecoveryPlanMock(...args),
  }),
}))

vi.mock('@/lib/tenant', () => ({
  getTenantConnectionIds: () => getTenantConnectionIdsMock(),
}))

import { checkExecutionTenantScope } from './executionScope'

beforeEach(() => {
  getExecutionMock.mockReset()
  getRecoveryPlanMock.mockReset()
  getTenantConnectionIdsMock.mockReset().mockResolvedValue(new Set(['conn-src', 'conn-dst']))
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('checkExecutionTenantScope', () => {
  it('traces back to the plan and allows access when the plan is in-tenant', async () => {
    getExecutionMock.mockResolvedValue({ data: { id: 'exec-1', plan_id: 'plan-1' } })
    getRecoveryPlanMock.mockResolvedValue({ data: { source_cluster: 'conn-src', target_cluster: 'conn-dst' } })

    const result = await checkExecutionTenantScope('exec-1')

    expect(result.denied).toBeNull()
    expect(result.execution).toEqual({ id: 'exec-1', plan_id: 'plan-1' })
  })

  it('denies access when the plan traced back via plan_id belongs to another tenant', async () => {
    getExecutionMock.mockResolvedValue({ data: { id: 'exec-1', plan_id: 'plan-1' } })
    getRecoveryPlanMock.mockResolvedValue({ data: { source_cluster: 'foreign', target_cluster: 'conn-dst' } })

    const result = await checkExecutionTenantScope('exec-1')

    expect(result.denied).not.toBeNull()
    expect(result.denied?.status).toBe(404)
    expect(await result.denied?.json()).toEqual({ error: 'Not found' })
  })

  it('keeps the execution visible when the plan lookup throws (plan deleted)', async () => {
    getExecutionMock.mockResolvedValue({ data: { id: 'exec-1', plan_id: 'plan-deleted' } })
    getRecoveryPlanMock.mockRejectedValue(new Error('Orchestrator 404: plan not found'))

    const result = await checkExecutionTenantScope('exec-1')

    expect(result.denied).toBeNull()
    expect(result.execution).toEqual({ id: 'exec-1', plan_id: 'plan-deleted' })
  })

  it('falls back to the execution own cluster fields when there is no plan_id', async () => {
    getExecutionMock.mockResolvedValue({ data: { id: 'exec-1', source_cluster: 'conn-src', target_cluster: 'conn-dst' } })

    const result = await checkExecutionTenantScope('exec-1')

    expect(result.denied).toBeNull()
    expect(getRecoveryPlanMock).not.toHaveBeenCalled()
  })

  it('denies access via the execution own cluster fields when out of tenant scope and there is no plan_id', async () => {
    getExecutionMock.mockResolvedValue({ data: { id: 'exec-1', source_cluster: 'foreign', target_cluster: 'conn-dst' } })

    const result = await checkExecutionTenantScope('exec-1')

    expect(result.denied).not.toBeNull()
    expect(result.denied?.status).toBe(404)
    expect(getRecoveryPlanMock).not.toHaveBeenCalled()
  })
})
