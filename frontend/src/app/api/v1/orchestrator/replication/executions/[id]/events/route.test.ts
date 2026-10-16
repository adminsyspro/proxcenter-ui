import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { callRoute, deniedPermissionResponse } from '@/__tests__/setup/route-test'

const checkPermissionMock = vi.fn()
const getExecutionMock = vi.fn()
const getExecutionEventsMock = vi.fn()
const getRecoveryPlanMock = vi.fn()
const getTenantConnectionIdsMock = vi.fn()

vi.mock('@/lib/rbac', () => ({
  checkPermission: (...args: unknown[]) => checkPermissionMock(...args),
  PERMISSIONS: { AUTOMATION_VIEW: 'automation.view' },
}))

vi.mock('@/lib/tenant', () => ({
  getTenantConnectionIds: () => getTenantConnectionIdsMock(),
}))

vi.mock('@/lib/orchestrator/client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/orchestrator/client')>()),
  getOrchestratorClient: () => ({
    getExecution: (...args: unknown[]) => getExecutionMock(...args),
    getExecutionEvents: (...args: unknown[]) => getExecutionEventsMock(...args),
    getRecoveryPlan: (...args: unknown[]) => getRecoveryPlanMock(...args),
  }),
}))

import { GET } from './route'

const EVENT = { id: 7, execution_id: 'exec-1', vm_id: 9943, step: 'fencing', level: 'check', message: 'Source VM 9943 stopped on node pve1', at: '2026-10-16T14:31:40Z' }

beforeEach(() => {
  checkPermissionMock.mockReset().mockResolvedValue(null)
  getTenantConnectionIdsMock.mockReset().mockResolvedValue(new Set(['conn-src', 'conn-dst']))
  getExecutionMock.mockReset().mockResolvedValue({ data: { id: 'exec-1', plan_id: 'plan-1', status: 'running' } })
  getRecoveryPlanMock.mockReset().mockResolvedValue({ data: { source_cluster: 'conn-src', target_cluster: 'conn-dst' } })
  getExecutionEventsMock.mockReset().mockResolvedValue({ data: [EVENT] })
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('GET /api/v1/orchestrator/replication/executions/[id]/events (ui#943)', () => {
  it('relays the events after the given id for an in-tenant execution', async () => {
    const res = await callRoute(GET, { params: { id: 'exec-1' }, url: 'http://localhost/x?after=6' })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual([EVENT])
    expect(getExecutionEventsMock).toHaveBeenCalledWith('exec-1', 6)
  })

  it('reads from the start on a missing or invalid cursor, and an empty answer as no event', async () => {
    getExecutionEventsMock.mockResolvedValue({ data: null })

    const res = await callRoute(GET, { params: { id: 'exec-1' }, url: 'http://localhost/x?after=abc' })

    expect(await res.json()).toEqual([])
    expect(getExecutionEventsMock).toHaveBeenCalledWith('exec-1', 0)
  })

  it('needs the automation permission', async () => {
    checkPermissionMock.mockResolvedValue(deniedPermissionResponse())

    const res = await callRoute(GET, { params: { id: 'exec-1' } })

    expect(res.status).toBe(403)
    expect(getExecutionEventsMock).not.toHaveBeenCalled()
  })

  it('hides the log of an execution outside the tenant', async () => {
    getRecoveryPlanMock.mockResolvedValue({ data: { source_cluster: 'foreign', target_cluster: 'conn-dst' } })

    const res = await callRoute(GET, { params: { id: 'exec-1' } })

    expect(res.status).toBe(404)
    expect(getExecutionEventsMock).not.toHaveBeenCalled()
  })

  it('answers 500 with the error when the orchestrator fails', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    getExecutionEventsMock.mockRejectedValue(new Error('boom'))

    const res = await callRoute(GET, { params: { id: 'exec-1' } })

    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'boom' })
    spy.mockRestore()
  })
})
