import { describe, expect, it, vi, beforeEach } from 'vitest'
import { callRoute, readJson, deniedPermissionResponse } from '@/__tests__/setup/route-test'

const getRecoveryPlanMock = vi.fn()
const getPlanRestorePointsMock = vi.fn()
const checkPermissionMock = vi.fn()

vi.mock('@/lib/orchestrator/client', () => ({
  getOrchestratorClient: () => ({
    getRecoveryPlan: (...args: unknown[]) => getRecoveryPlanMock(...args),
    getPlanRestorePoints: (...args: unknown[]) => getPlanRestorePointsMock(...args),
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

import { GET } from './route'

const fakePlan = {
  id: 'plan-1',
  source_cluster: 'conn-src',
  target_cluster: 'conn-dst',
}

const fakeRestorePoints = {
  plan_id: 'plan-1',
  target_cluster: 'conn-dst',
  vms: [
    { vm_id: 100, vm_name: 'web-01', target_vmid: 9100, disk_count: 1, restore_points: [{ snapshot: 'snap-2', created_ts: 2, created_iso: '2026-01-02T00:00:00Z' }] },
  ],
}

beforeEach(() => {
  checkPermissionMock.mockReset().mockResolvedValue(null)
  getRecoveryPlanMock.mockReset().mockResolvedValue({ data: fakePlan })
  getPlanRestorePointsMock.mockReset().mockResolvedValue({ data: fakeRestorePoints })
})

describe('GET /api/v1/orchestrator/replication/plans/[id]/restore-points', () => {
  it('returns the restore points passthrough on 200', async () => {
    const res = await callRoute(GET as Parameters<typeof callRoute>[0], { params: { id: 'plan-1' } })
    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual(fakeRestorePoints)
    expect(getPlanRestorePointsMock).toHaveBeenCalledWith('plan-1')
  })

  it('returns denied response when permission check fails', async () => {
    checkPermissionMock.mockResolvedValue(deniedPermissionResponse())
    const res = await callRoute(GET as Parameters<typeof callRoute>[0], { params: { id: 'plan-1' } })
    expect(res.status).toBe(403)
    expect(getPlanRestorePointsMock).not.toHaveBeenCalled()
  })

  it('returns 404 when the plan belongs to a connection outside the tenant scope', async () => {
    getRecoveryPlanMock.mockResolvedValue({ data: { ...fakePlan, source_cluster: 'conn-other' } })
    const res = await callRoute(GET as Parameters<typeof callRoute>[0], { params: { id: 'plan-1' } })
    expect(res.status).toBe(404)
    expect(getPlanRestorePointsMock).not.toHaveBeenCalled()
  })

  it('returns a 500 with the error message when the orchestrator call fails', async () => {
    getPlanRestorePointsMock.mockRejectedValue(new Error('boom'))
    const res = await callRoute(GET as Parameters<typeof callRoute>[0], { params: { id: 'plan-1' } })
    expect(res.status).toBe(500)
    expect(await readJson(res)).toEqual({ error: 'boom' })
  })
})
