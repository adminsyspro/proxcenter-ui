/**
 * The per-VM Site Recovery actions: what they send, what they do with a
 * refusal, and how long the screen keeps looking again afterwards.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  EMERGENCY_REFRESH_DELAYS,
  buildVmStatesByConn,
  loadVMRestorePoints,
  saveRecoveryPlan,
  scheduleRefreshes,
  startDRVM,
  stopDRVM,
} from './emergencyActions'

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function ok(payload: unknown = {}) {
  return { ok: true, status: 200, json: async () => payload }
}

function fail(status: number, payload: unknown = {}) {
  return { ok: false, status, statusText: 'Bad Request', json: async () => payload }
}

function body() {
  return JSON.parse(fetchMock.mock.calls[0][1].body)
}

describe('replica power states per connection', () => {
  it('keeps a replica and its source apart when they share a VMID', () => {
    const states = buildVmStatesByConn([
      { vmid: 100, status: 'running', connId: 'src' },
      { vmid: 100, status: 'stopped', connId: 'dst' },
    ])

    expect(states.src[100]).toBe('running')
    expect(states.dst[100]).toBe('stopped')
  })

  it('skips an inventory row missing the vmid, the state or the connection', () => {
    const states = buildVmStatesByConn([
      { vmid: 0, status: 'running', connId: 'src' },
      { vmid: 101, connId: 'src' },
      { vmid: 102, status: 'running' },
    ])

    expect(states).toEqual({})
  })
})

describe('starting a replica on the DR site', () => {
  it('sends the guest, its target cluster, its job and the chosen restore point', async () => {
    fetchMock.mockResolvedValue(ok())

    await startDRVM({ vmId: 103, targetCluster: 'dst', jobId: 'job-1', restorePoint: 'mirror-20260916', conflictMessage: 'busy' })

    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/orchestrator/replication/emergency/start-vm')
    expect(body()).toEqual({
      vm_id: 103,
      target_cluster: 'dst',
      replication_job_id: 'job-1',
      restore_point: 'mirror-20260916',
    })
  })

  it('leaves the restore point out when the operator kept the latest state', async () => {
    fetchMock.mockResolvedValue(ok())

    await startDRVM({ vmId: 103, targetCluster: 'dst', jobId: 'job-1', conflictMessage: 'busy' })

    expect(body().restore_point).toBeUndefined()
  })

  it('reports the orchestrator refusal as it stands', async () => {
    fetchMock.mockResolvedValue(fail(400, { error: 'replication job nightly is syncing right now' }))

    await expect(startDRVM({ vmId: 103, targetCluster: 'dst', jobId: 'job-1', conflictMessage: 'busy' }))
      .rejects.toThrow('replication job nightly is syncing right now')
  })

  it('says a test failover holds the guest when the answer is a conflict', async () => {
    fetchMock.mockResolvedValue(fail(409, {}))

    await expect(startDRVM({ vmId: 103, targetCluster: 'dst', jobId: 'job-1', conflictMessage: 'a test failover is running' }))
      .rejects.toThrow('a test failover is running')
  })

  it('falls back to its own wording when the refusal carries no message', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, statusText: 'Server Error', json: async () => { throw new Error('not json') } })

    await expect(startDRVM({ vmId: 103, targetCluster: 'dst', jobId: 'job-1', conflictMessage: 'busy' }))
      .rejects.toThrow('Failed to start VM')
  })
})

describe('stopping a replica', () => {
  it('carries whether replication resumes with it', async () => {
    fetchMock.mockResolvedValue(ok())

    await stopDRVM({ vmId: 103, targetCluster: 'dst', jobId: 'job-1', resumeReplication: true, conflictMessage: 'busy' })

    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/orchestrator/replication/emergency/stop-vm')
    expect(body().resume_replication).toBe(true)
  })

  it('reports a refusal instead of pretending the replica stopped', async () => {
    fetchMock.mockResolvedValue(fail(500, { error: 'stop VM 5103 failed' }))

    await expect(stopDRVM({ vmId: 103, targetCluster: 'dst', jobId: 'job-1', resumeReplication: false, conflictMessage: 'busy' }))
      .rejects.toThrow('stop VM 5103 failed')
  })
})

describe('restore points of one guest', () => {
  it('asks the endpoint scoped to that job and that guest', async () => {
    fetchMock.mockResolvedValue(ok({ restore_points: [{ snapshot: 'mirror-1' }] }))

    const points = await loadVMRestorePoints('job-1', 103)

    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/orchestrator/replication/jobs/job-1/vms/103/restore-points')
    expect(points.restore_points).toHaveLength(1)
  })

  it('surfaces why the list could not be read', async () => {
    fetchMock.mockResolvedValue(fail(400, { error: 'VM 999 is not replicated by job job-1' }))

    await expect(loadVMRestorePoints('job-1', 999)).rejects.toThrow('VM 999 is not replicated by job job-1')
  })
})

describe('saving a recovery plan', () => {
  it('creates with a POST when there is no plan yet', async () => {
    fetchMock.mockResolvedValue(ok())

    expect(await saveRecoveryPlan({ name: 'critical' }, null)).toEqual({ error: null })
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/orchestrator/replication/plans')
    expect(fetchMock.mock.calls[0][1].method).toBe('POST')
  })

  it('edits with a PUT onto the plan being edited', async () => {
    fetchMock.mockResolvedValue(ok())

    await saveRecoveryPlan({ name: 'critical' }, 'plan-7')

    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/orchestrator/replication/plans/plan-7')
    expect(fetchMock.mock.calls[0][1].method).toBe('PUT')
  })

  it('returns the refusal of an edit the orchestrator will not take', async () => {
    fetchMock.mockResolvedValue(fail(409, { error: 'plan is failing back' }))

    expect(await saveRecoveryPlan({}, 'plan-7')).toEqual({ error: 'plan is failing back' })
  })

  it('falls back to the status text when the refusal has no message', async () => {
    fetchMock.mockResolvedValue(fail(400, {}))

    expect(await saveRecoveryPlan({}, null)).toEqual({ error: 'Bad Request' })
  })
})

describe('looking again after an emergency action', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('refreshes at once, then once per delay of the minute that follows', () => {
    const refresh = vi.fn()

    const timers = scheduleRefreshes(refresh)

    expect(refresh).toHaveBeenCalledTimes(1)
    expect(timers).toHaveLength(EMERGENCY_REFRESH_DELAYS.length)

    vi.advanceTimersByTime(60_000)
    expect(refresh).toHaveBeenCalledTimes(1 + EMERGENCY_REFRESH_DELAYS.length)
  })

  it('hands back its timers so leaving the page cancels them', () => {
    const refresh = vi.fn()

    scheduleRefreshes(refresh, [1000, 2000]).forEach(clearTimeout)

    vi.advanceTimersByTime(60_000)
    expect(refresh).toHaveBeenCalledTimes(1)
  })
})
