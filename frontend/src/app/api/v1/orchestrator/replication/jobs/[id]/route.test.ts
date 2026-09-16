import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

const checkPermissionMock = vi.fn()
const getTenantConnectionIdsMock = vi.fn()
const getReplicationJobMock = vi.fn()
const updateReplicationJobMock = vi.fn()

vi.mock('@/lib/rbac', () => ({
  checkPermission: (...args: unknown[]) => checkPermissionMock(...args),
  PERMISSIONS: {
    AUTOMATION_VIEW: 'automation.view',
    AUTOMATION_MANAGE: 'automation.manage',
  },
}))

vi.mock('@/lib/tenant', () => ({
  getTenantConnectionIds: () => getTenantConnectionIdsMock(),
}))

// Keep the real parseOrchestratorError so the status passthrough is exercised
// for real; only stub the network-facing client factory.
vi.mock('@/lib/orchestrator/client', async importActual => {
  const actual = await importActual<typeof import('@/lib/orchestrator/client')>()

  return {
    ...actual,
    getOrchestratorClient: () => ({
      getReplicationJob: (...args: unknown[]) => getReplicationJobMock(...args),
      updateReplicationJob: (...args: unknown[]) => updateReplicationJobMock(...args),
    }),
  }
})

import { PUT } from './route'

const route = PUT as Parameters<typeof callRoute>[0]

const fakeJob = {
  id: 'job-1',
  source_cluster: 'conn-src',
  target_cluster: 'conn-dst',
}

// The exact shape orchestratorFetch throws for a non-OK upstream response:
// `Orchestrator ${status}: ${rawBody}`.
function upstreamError(status: number, message: string) {
  return new Error(`Orchestrator ${status}: ${JSON.stringify({ error: message })}`)
}

function putJob(body: Record<string, unknown> = { schedule: '*/30 * * * *' }) {
  return callRoute(route, { params: { id: 'job-1' }, method: 'PUT', body })
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  checkPermissionMock.mockReset().mockResolvedValue(null)
  getTenantConnectionIdsMock.mockReset().mockResolvedValue(new Set(['conn-src', 'conn-dst']))
  getReplicationJobMock.mockReset().mockResolvedValue({ data: fakeJob })
  updateReplicationJobMock.mockReset().mockResolvedValue({ data: { ...fakeJob, schedule: '*/30 * * * *' } })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('PUT /api/v1/orchestrator/replication/jobs/[id]', () => {
  it('returns the updated job from the orchestrator on success', async () => {
    const res = await putJob()

    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual({ ...fakeJob, schedule: '*/30 * * * *' })
    expect(updateReplicationJobMock).toHaveBeenCalledWith('job-1', { schedule: '*/30 * * * *' })
  })

  it('answers with the orchestrator status and message when it refuses the edit', async () => {
    updateReplicationJobMock.mockRejectedValue(
      upstreamError(400, 'the replica of this guest is running, stop it before editing the job'),
    )

    const res = await putJob()

    expect(res.status).toBe(400)
    expect(await readJson(res)).toEqual({
      error: 'the replica of this guest is running, stop it before editing the job',
    })
  })

  it('keeps the orchestrator status for a conflict raised by another job on the same guest', async () => {
    updateReplicationJobMock.mockRejectedValue(upstreamError(409, 'this guest is already replicated by another job'))

    const res = await putJob()

    expect(res.status).toBe(409)
    expect(await readJson(res)).toEqual({ error: 'this guest is already replicated by another job' })
  })

  it('still answers 500 when the failure is not an orchestrator refusal', async () => {
    updateReplicationJobMock.mockRejectedValue(new Error('socket hang up'))

    const res = await putJob()

    expect(res.status).toBe(500)
    expect(await readJson(res)).toEqual({ error: 'socket hang up' })
  })
})
