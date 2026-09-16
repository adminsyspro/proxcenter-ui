import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { callRoute, deniedPermissionResponse, readJson } from '@/__tests__/setup/route-test'

const checkPermissionMock = vi.fn()
const getTenantConnectionIdsMock = vi.fn()
const getReplicationJobMock = vi.fn()
const getJobVMRestorePointsMock = vi.fn()

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
      getJobVMRestorePoints: (...args: unknown[]) => getJobVMRestorePointsMock(...args),
    }),
  }
})

import { GET } from './route'

const route = GET as Parameters<typeof callRoute>[0]

const fakeJob = {
  id: 'job-1',
  source_cluster: 'conn-src',
  target_cluster: 'conn-dst',
}

const fakeRestorePoints = {
  job_id: 'job-1',
  vm_id: 101,
  target_vmid: 9101,
  restore_points: [
    { snapshot: 'repl-2', created_ts: 2, created_iso: '2026-09-02T00:00:00Z' },
    { snapshot: 'repl-1', created_ts: 1, created_iso: '2026-09-01T00:00:00Z' },
  ],
}

// The exact shape orchestratorFetch throws for a non-OK upstream response:
// `Orchestrator ${status}: ${rawBody}`.
function upstreamError(status: number, message: string) {
  return new Error(`Orchestrator ${status}: ${JSON.stringify({ error: message })}`)
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  checkPermissionMock.mockReset().mockResolvedValue(null)
  getTenantConnectionIdsMock.mockReset().mockResolvedValue(new Set(['conn-src', 'conn-dst']))
  getReplicationJobMock.mockReset().mockResolvedValue({ data: fakeJob })
  getJobVMRestorePointsMock.mockReset().mockResolvedValue({ data: fakeRestorePoints })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('GET /api/v1/orchestrator/replication/jobs/[id]/vms/[vmid]/restore-points', () => {
  it('returns the orchestrator restore points as-is for a guest of an in-tenant job', async () => {
    const res = await callRoute(route, { params: { id: 'job-1', vmid: '101' } })

    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual(fakeRestorePoints)
    expect(getJobVMRestorePointsMock).toHaveBeenCalledWith('job-1', 101)
  })

  it('rejects a non-numeric vmid with a 400 without calling the orchestrator', async () => {
    const res = await callRoute(route, { params: { id: 'job-1', vmid: 'abc' } })

    expect(res.status).toBe(400)
    expect(await readJson(res)).toEqual({ error: 'vmid must be a positive integer' })
    expect(getReplicationJobMock).not.toHaveBeenCalled()
    expect(getJobVMRestorePointsMock).not.toHaveBeenCalled()
  })

  it('rejects a vmid of zero with a 400 without calling the orchestrator', async () => {
    const res = await callRoute(route, { params: { id: 'job-1', vmid: '0' } })

    expect(res.status).toBe(400)
    expect(await readJson(res)).toEqual({ error: 'vmid must be a positive integer' })
    expect(getReplicationJobMock).not.toHaveBeenCalled()
    expect(getJobVMRestorePointsMock).not.toHaveBeenCalled()
  })

  it('answers 404 when the job replicates from a cluster outside the tenant', async () => {
    getReplicationJobMock.mockResolvedValue({ data: { ...fakeJob, source_cluster: 'conn-foreign' } })

    const res = await callRoute(route, { params: { id: 'job-1', vmid: '101' } })

    expect(res.status).toBe(404)
    expect(await readJson(res)).toEqual({ error: 'Not found' })
    expect(getJobVMRestorePointsMock).not.toHaveBeenCalled()
  })

  it('answers 404 when the job replicates to a cluster outside the tenant', async () => {
    getReplicationJobMock.mockResolvedValue({ data: { ...fakeJob, target_cluster: 'conn-foreign' } })

    const res = await callRoute(route, { params: { id: 'job-1', vmid: '101' } })

    expect(res.status).toBe(404)
    expect(await readJson(res)).toEqual({ error: 'Not found' })
    expect(getJobVMRestorePointsMock).not.toHaveBeenCalled()
  })

  it('still answers when the orchestrator returns no job to check ownership against', async () => {
    getReplicationJobMock.mockResolvedValue({ data: null })

    const res = await callRoute(route, { params: { id: 'job-1', vmid: '101' } })

    expect(res.status).toBe(200)
    expect(getJobVMRestorePointsMock).toHaveBeenCalledWith('job-1', 101)
  })

  it('returns the denied response when permission is refused, without calling the orchestrator', async () => {
    checkPermissionMock.mockResolvedValue(deniedPermissionResponse())

    const res = await callRoute(route, { params: { id: 'job-1', vmid: '101' } })

    expect(res.status).toBe(403)
    expect(getReplicationJobMock).not.toHaveBeenCalled()
    expect(getJobVMRestorePointsMock).not.toHaveBeenCalled()
  })

  it('passes an orchestrator refusal through with its own status and message', async () => {
    getJobVMRestorePointsMock.mockRejectedValue(upstreamError(404, 'no replica for this guest yet'))

    const res = await callRoute(route, { params: { id: 'job-1', vmid: '101' } })

    expect(res.status).toBe(404)
    expect(await readJson(res)).toEqual({ error: 'no replica for this guest yet' })
  })

  it('answers 500 with the error message when the call fails for any other reason', async () => {
    getJobVMRestorePointsMock.mockRejectedValue(new Error('boom'))

    const res = await callRoute(route, { params: { id: 'job-1', vmid: '101' } })

    expect(res.status).toBe(500)
    expect(await readJson(res)).toEqual({ error: 'boom' })
  })

  it('falls back to a generic 500 message when the failure carries none', async () => {
    getJobVMRestorePointsMock.mockRejectedValue({})

    const res = await callRoute(route, { params: { id: 'job-1', vmid: '101' } })

    expect(res.status).toBe(500)
    expect(await readJson(res)).toEqual({ error: 'Failed to fetch restore points' })
  })

  it('keeps an unavailable orchestrator out of the server log', async () => {
    getJobVMRestorePointsMock.mockRejectedValue(
      Object.assign(new Error('orchestrator unreachable'), { code: 'ORCHESTRATOR_UNAVAILABLE' }),
    )

    const res = await callRoute(route, { params: { id: 'job-1', vmid: '101' } })

    expect(res.status).toBe(500)
    expect(await readJson(res)).toEqual({ error: 'orchestrator unreachable' })
    expect(console.error).not.toHaveBeenCalled()
  })
})
