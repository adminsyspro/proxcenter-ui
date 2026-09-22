import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { callRoute, deniedPermissionResponse } from '@/__tests__/setup/route-test'

const getReplicationJobMock = vi.fn()
const cancelReplicationJobMock = vi.fn()
const checkPermissionMock = vi.fn()

// The real parseOrchestratorError stays in place: the whole point of this
// route is that the orchestrator's 409 reaches the operator as its own
// sentence instead of a flat 500.
vi.mock('@/lib/orchestrator/client', async importActual => {
  const actual = await importActual<typeof import('@/lib/orchestrator/client')>()

  return {
    ...actual,
    getOrchestratorClient: () => ({
      getReplicationJob: (...args: unknown[]) => getReplicationJobMock(...args),
      cancelReplicationJob: (...args: unknown[]) => cancelReplicationJobMock(...args),
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

const fakeJob = { id: 'job-1', source_cluster: 'conn-src', target_cluster: 'conn-dst' }

beforeEach(() => {
  checkPermissionMock.mockReset().mockResolvedValue(null)
  getReplicationJobMock.mockReset().mockResolvedValue({ data: fakeJob })
  cancelReplicationJobMock.mockReset().mockResolvedValue({ data: { status: 'cancelling' } })
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('POST /api/v1/orchestrator/replication/jobs/[id]/cancel', () => {
  it('stops the run and answers what the orchestrator answered', async () => {
    const res = await callRoute(POST as Parameters<typeof callRoute>[0], { params: { id: 'job-1' } })

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'cancelling' })
    expect(cancelReplicationJobMock).toHaveBeenCalledWith('job-1')
  })

  it('refuses without automation.manage', async () => {
    checkPermissionMock.mockResolvedValue(deniedPermissionResponse())

    const res = await callRoute(POST as Parameters<typeof callRoute>[0], { params: { id: 'job-1' } })

    expect(res.status).toBe(403)
    expect(cancelReplicationJobMock).not.toHaveBeenCalled()
  })

  it('404s on a job whose clusters are outside the tenant perimeter', async () => {
    getReplicationJobMock.mockResolvedValue({ data: { ...fakeJob, target_cluster: 'foreign' } })

    const res = await callRoute(POST as Parameters<typeof callRoute>[0], { params: { id: 'job-1' } })

    expect(res.status).toBe(404)
    expect(cancelReplicationJobMock).not.toHaveBeenCalled()
  })

  it('keeps the 409 the orchestrator sends when no run is in flight here', async () => {
    // In HA the run may belong to another instance. Flattening this to a 500
    // would tell the operator the product is broken rather than where the run
    // actually is.
    cancelReplicationJobMock.mockRejectedValue(
      new Error('Orchestrator 409: {"error":"no run in flight for this job on this orchestrator instance"}'),
    )

    const res = await callRoute(POST as Parameters<typeof callRoute>[0], { params: { id: 'job-1' } })

    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/no run in flight/i)
  })
})
