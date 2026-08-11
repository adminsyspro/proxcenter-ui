import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { callRoute, deniedPermissionResponse } from '@/__tests__/setup/route-test'

const checkPermissionMock = vi.fn()
const getTenantConnectionIdsMock = vi.fn()
const getRecoveryPlanMock = vi.fn()
const executeFailbackMock = vi.fn()
const failbackCutoverMock = vi.fn()
const failbackCancelMock = vi.fn()

vi.mock('@/lib/rbac', () => ({
  checkPermission: (...args: unknown[]) => checkPermissionMock(...args),
  PERMISSIONS: { AUTOMATION_MANAGE: 'automation.manage' },
}))

vi.mock('@/lib/tenant', () => ({
  getTenantConnectionIds: () => getTenantConnectionIdsMock(),
}))

// Keep the real parseOrchestratorError so the 409-passthrough behaviour is
// exercised for real; only stub the network-facing client factory.
vi.mock('@/lib/orchestrator/client', async importActual => {
  const actual = await importActual<typeof import('@/lib/orchestrator/client')>()

  return {
    ...actual,
    getOrchestratorClient: () => ({
      getRecoveryPlan: (...args: unknown[]) => getRecoveryPlanMock(...args),
      executeFailback: (...args: unknown[]) => executeFailbackMock(...args),
      failbackCutover: (...args: unknown[]) => failbackCutoverMock(...args),
      failbackCancel: (...args: unknown[]) => failbackCancelMock(...args),
    }),
  }
})

import { POST as failbackPOST } from '../failback/route'
import { POST as failbackCancelPOST } from '../failback-cancel/route'
import { POST as failbackCutoverPOST } from './route'

const fakePlan = {
  id: 'plan-1',
  source_cluster: 'conn-src',
  target_cluster: 'conn-dst',
}

// The exact shape orchestratorFetch throws for a non-OK upstream response:
// `Orchestrator ${status}: ${rawBody}`.
function upstreamConflict(message: string) {
  return new Error(`Orchestrator 409: ${JSON.stringify({ error: message })}`)
}

beforeEach(() => {
  checkPermissionMock.mockReset().mockResolvedValue(null)
  getTenantConnectionIdsMock.mockReset().mockResolvedValue(new Set(['conn-src', 'conn-dst']))
  getRecoveryPlanMock.mockReset().mockResolvedValue({ data: fakePlan })
  executeFailbackMock.mockReset().mockResolvedValue({ data: { id: 'exec-1', status: 'running' } })
  failbackCutoverMock.mockReset().mockResolvedValue({ data: { status: 'cutover_started' } })
  failbackCancelMock.mockReset().mockResolvedValue({ data: { status: 'cancelled' } })
})

afterEach(() => {
  vi.clearAllMocks()
})

describe.each([
  {
    name: 'POST /replication/plans/[id]/failback',
    handler: () => failbackPOST as Parameters<typeof callRoute>[0],
    actionMock: () => executeFailbackMock,
    expectedData: { id: 'exec-1', status: 'running' },
  },
  {
    name: 'POST /replication/plans/[id]/failback-cutover',
    handler: () => failbackCutoverPOST as Parameters<typeof callRoute>[0],
    actionMock: () => failbackCutoverMock,
    expectedData: { status: 'cutover_started' },
  },
  {
    name: 'POST /replication/plans/[id]/failback-cancel',
    handler: () => failbackCancelPOST as Parameters<typeof callRoute>[0],
    actionMock: () => failbackCancelMock,
    expectedData: { status: 'cancelled' },
  },
])('$name', ({ handler, actionMock, expectedData }) => {
  it('returns the denied response when permission is refused', async () => {
    checkPermissionMock.mockResolvedValue(deniedPermissionResponse())

    const res = await callRoute(handler(), { params: { id: 'plan-1' } })

    expect(res.status).toBe(403)
    expect(getRecoveryPlanMock).not.toHaveBeenCalled()
    expect(actionMock()).not.toHaveBeenCalled()
  })

  it('404s when the plan belongs to another tenant', async () => {
    getRecoveryPlanMock.mockResolvedValue({ data: { ...fakePlan, source_cluster: 'foreign' } })

    const res = await callRoute(handler(), { params: { id: 'plan-1' } })

    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Not found' })
    expect(actionMock()).not.toHaveBeenCalled()
  })

  it('passes through an upstream 409 conflict with the same error message', async () => {
    actionMock().mockRejectedValue(upstreamConflict('a failback is already in progress for this plan'))

    const res = await callRoute(handler(), { params: { id: 'plan-1' } })

    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'a failback is already in progress for this plan' })
  })

  it('returns the upstream success payload on 200', async () => {
    const res = await callRoute(handler(), { params: { id: 'plan-1' } })

    expect(res.status).toBe(200)
    expect(actionMock()).toHaveBeenCalledWith('plan-1')
    expect(await res.json()).toEqual(expectedData)
  })
})
