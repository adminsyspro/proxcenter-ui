import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { callRoute } from '@/__tests__/setup/route-test'

const checkPermission = vi.fn()
const getRecoveryPlan = vi.fn()
const clearRecoveryHistory = vi.fn()

vi.mock('@/lib/rbac', () => ({
  checkPermission: (...args: unknown[]) => checkPermission(...args),
  PERMISSIONS: { AUTOMATION_VIEW: 'automation.view', AUTOMATION_MANAGE: 'automation.manage' },
}))
vi.mock('@/lib/tenant', () => ({
  getTenantConnectionIds: vi.fn().mockResolvedValue(new Set(['conn-src', 'conn-dst'])),
}))
vi.mock('@/lib/orchestrator/client', () => ({
  getOrchestratorClient: () => ({ getRecoveryPlan, clearRecoveryHistory }),
}))

import { DELETE } from './route'

beforeEach(() => {
  checkPermission.mockReset().mockResolvedValue(null)
  getRecoveryPlan.mockReset().mockResolvedValue({ data: { source_cluster: 'conn-src', target_cluster: 'conn-dst' } })
  clearRecoveryHistory.mockReset().mockResolvedValue({ data: { deleted: 3 } })
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('DELETE /api/v1/orchestrator/replication/plans/[id]/history', () => {
  it('denies the call when permission is missing', async () => {
    const denial = new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 })
    checkPermission.mockResolvedValue(denial)

    const res = await callRoute(DELETE, { params: { id: 'plan-1' }, method: 'DELETE' })

    expect(res.status).toBe(403)
    expect(clearRecoveryHistory).not.toHaveBeenCalled()
  })

  it('404s when the plan belongs to another tenant', async () => {
    getRecoveryPlan.mockResolvedValue({ data: { source_cluster: 'foreign', target_cluster: 'conn-dst' } })

    const res = await callRoute(DELETE, { params: { id: 'plan-1' }, method: 'DELETE' })

    expect(res.status).toBe(404)
    expect(clearRecoveryHistory).not.toHaveBeenCalled()
  })

  it('clears the history for an in-tenant plan', async () => {
    const res = await callRoute(DELETE, { params: { id: 'plan-1' }, method: 'DELETE' })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ deleted: 3 })
    expect(clearRecoveryHistory).toHaveBeenCalledWith('plan-1')
  })
})
