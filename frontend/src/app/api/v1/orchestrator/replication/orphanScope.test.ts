/**
 * ui#1394: a job or plan whose connection was deleted stays in the
 * orchestrator. The provider sees it flagged and may delete it; it no longer
 * hides from the list while the dashboard counts it. A tenant still never sees
 * a job on a connection outside its own set.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

const { checkPermissionMock, tenantIdMock, connectionIdsMock, client } = vi.hoisted(() => ({
  checkPermissionMock: vi.fn(),
  tenantIdMock: vi.fn(),
  connectionIdsMock: vi.fn(),
  client: {
    getReplicationJobs: vi.fn(),
    getReplicationJob: vi.fn(),
    updateReplicationJob: vi.fn(),
    deleteReplicationJob: vi.fn(),
    getRecoveryPlans: vi.fn(),
    getRecoveryPlan: vi.fn(),
    updateRecoveryPlan: vi.fn(),
    deleteRecoveryPlan: vi.fn(),
    getReplicationHealth: vi.fn(),
  },
}))

vi.mock('@/lib/rbac', () => ({
  checkPermission: (...args: unknown[]) => checkPermissionMock(...args),
  PERMISSIONS: { AUTOMATION_VIEW: 'automation.view', AUTOMATION_MANAGE: 'automation.manage' },
}))

vi.mock('@/lib/tenant', () => ({
  DEFAULT_TENANT_ID: 'default',
  getCurrentTenantId: () => tenantIdMock(),
  getTenantConnectionIds: () => connectionIdsMock(),
}))

vi.mock('@/lib/orchestrator/client', async importActual => {
  const actual = await importActual<typeof import('@/lib/orchestrator/client')>()

  return { ...actual, getOrchestratorClient: () => client }
})

import { GET as listJobs } from './jobs/route'
import { DELETE as deleteJob, GET as getJob, PUT as putJob } from './jobs/[id]/route'
import { GET as listPlans } from './plans/route'
import { DELETE as deletePlan, GET as getPlan, PUT as putPlan } from './plans/[id]/route'
import { GET as getStatus } from './status/route'

type Route = Parameters<typeof callRoute>[0]

// The [id] handlers take Next's params promise, which callRoute supplies.
const asRoute = (handler: unknown) => handler as Route
const json = async <T,>(res: Response): Promise<T> => (await readJson<T>(res)) as T

const liveJob = { id: 'live', name: 'Live', status: 'synced', source_cluster: 'prod', target_cluster: 'dr' }
const orphanJob = { id: 'orphan', name: 'Orphan', status: 'error', source_cluster: 'prod', target_cluster: 'gone' }
const foreignJob = { id: 'foreign', name: 'Foreign', status: 'error', source_cluster: 'other', target_cluster: 'other-dr' }
const livePlan = { id: 'p-live', name: 'Live plan', source_cluster: 'prod', target_cluster: 'dr' }
const orphanPlan = { id: 'p-orphan', name: 'Orphan plan', source_cluster: 'prod', target_cluster: 'gone' }

function asProvider() {
  tenantIdMock.mockResolvedValue('default')
  connectionIdsMock.mockResolvedValue(new Set(['prod', 'dr']))
}

function asTenant() {
  tenantIdMock.mockResolvedValue('acme')
  connectionIdsMock.mockResolvedValue(new Set(['prod', 'dr']))
}

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
  checkPermissionMock.mockResolvedValue(null)
  asProvider()
  client.getReplicationJobs.mockResolvedValue({ data: [liveJob, orphanJob] })
  client.getReplicationJob.mockImplementation(async (id: string) => ({ data: [liveJob, orphanJob, foreignJob].find(j => j.id === id) }))
  client.deleteReplicationJob.mockResolvedValue({ data: { status: 'deleted' } })
  client.updateReplicationJob.mockResolvedValue({ data: {} })
  client.getRecoveryPlans.mockResolvedValue({ data: [livePlan, orphanPlan] })
  client.getRecoveryPlan.mockImplementation(async (id: string) => ({ data: [livePlan, orphanPlan].find(p => p.id === id) }))
  client.deleteRecoveryPlan.mockResolvedValue({ data: { status: 'deleted' } })
  client.updateRecoveryPlan.mockResolvedValue({ data: {} })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.clearAllMocks()
})

describe('GET /replication/jobs', () => {
  it('lists a job on a deleted connection to the provider, flagged', async () => {
    const res = await callRoute(asRoute(listJobs), {})
    const body = await json<any[]>(res)

    expect(body.map(j => [j.id, j.missing_connections])).toEqual([
      ['live', undefined],
      ['orphan', ['target']],
    ])
  })

  it('keeps hiding a job outside the tenant from a tenant', async () => {
    asTenant()
    client.getReplicationJobs.mockResolvedValue({ data: [liveJob, foreignJob] })

    const body = await json<any[]>(await callRoute(asRoute(listJobs), {}))

    expect(body.map(j => j.id)).toEqual(['live'])
  })
})

describe('/replication/jobs/[id]', () => {
  it('opens an orphan job for the provider', async () => {
    const res = await callRoute(asRoute(getJob), { params: { id: 'orphan' } })

    expect(res.status).toBe(200)
    expect((await json<any>(res)).missing_connections).toEqual(['target'])
  })

  it('lets the provider delete an orphan job', async () => {
    const res = await callRoute(asRoute(deleteJob), { params: { id: 'orphan' }, method: 'DELETE' })

    expect(res.status).toBe(200)
    expect(client.deleteReplicationJob).toHaveBeenCalledWith('orphan')
  })

  it('refuses to edit an orphan job: it can no longer run', async () => {
    const res = await callRoute(asRoute(putJob), { params: { id: 'orphan' }, method: 'PUT', body: { schedule: '*/5 * * * *' } })

    expect(res.status).toBe(404)
    expect(client.updateReplicationJob).not.toHaveBeenCalled()
  })

  it('still answers 404 to a tenant deleting a job outside its connections', async () => {
    asTenant()

    const res = await callRoute(asRoute(deleteJob), { params: { id: 'foreign' }, method: 'DELETE' })

    expect(res.status).toBe(404)
    expect(client.deleteReplicationJob).not.toHaveBeenCalled()
  })
})

describe('recovery plans', () => {
  it('lists an orphan plan to the provider, flagged', async () => {
    const body = await json<any[]>(await callRoute(asRoute(listPlans), {}))

    expect(body.map(p => [p.id, p.missing_connections])).toEqual([
      ['p-live', undefined],
      ['p-orphan', ['target']],
    ])
  })

  it('hides an orphan plan from a tenant', async () => {
    asTenant()

    const body = await json<any[]>(await callRoute(asRoute(listPlans), {}))

    expect(body.map(p => p.id)).toEqual(['p-live'])
  })

  it('opens and deletes an orphan plan for the provider, but does not edit it', async () => {
    expect((await callRoute(asRoute(getPlan), { params: { id: 'p-orphan' } })).status).toBe(200)

    const del = await callRoute(asRoute(deletePlan), { params: { id: 'p-orphan' }, method: 'DELETE' })
    expect(del.status).toBe(200)
    expect(client.deleteRecoveryPlan).toHaveBeenCalledWith('p-orphan')

    const put = await callRoute(asRoute(putPlan), { params: { id: 'p-orphan' }, method: 'PUT', body: { name: 'x' } })
    expect(put.status).toBe(404)
    expect(client.updateRecoveryPlan).not.toHaveBeenCalled()
  })
})

describe('GET /replication/status', () => {
  const health = {
    sites: [{ cluster_id: 'prod' }, { cluster_id: 'other' }],
    kpis: { protected_vms: 3, error_count: 2, total_jobs: 3, avg_rpo_seconds: 60 },
    job_summary: { synced: 1, syncing: 0, pending: 0, error: 2, paused: 0, no_match: 0, partial: 0 },
  }

  it('counts the jobs the tenant can see, not every job of the fleet', async () => {
    asTenant()
    client.getReplicationHealth.mockResolvedValue({ data: structuredClone(health) })
    client.getReplicationJobs.mockResolvedValue({ data: [liveJob, foreignJob, orphanJob] })

    const body = await json<any>(await callRoute(asRoute(getStatus), {}))

    expect(body.job_summary).toEqual({ synced: 1, syncing: 0, pending: 0, error: 0, paused: 0, no_match: 0, partial: 0 })
    expect(body.kpis).toMatchObject({ error_count: 0, total_jobs: 1, avg_rpo_seconds: 60 })
    expect(body.sites).toEqual([{ cluster_id: 'prod' }])
  })

  it('counts the orphan for the provider, which now sees it in the list too', async () => {
    client.getReplicationHealth.mockResolvedValue({ data: structuredClone(health) })

    const body = await json<any>(await callRoute(asRoute(getStatus), {}))

    expect(body.job_summary).toMatchObject({ synced: 1, error: 1 })
    expect(body.kpis).toMatchObject({ error_count: 1, total_jobs: 2 })
  })

  it('keeps the orchestrator counters when the job list cannot be read', async () => {
    client.getReplicationHealth.mockResolvedValue({ data: structuredClone(health) })
    client.getReplicationJobs.mockRejectedValue(new Error('boom'))

    const body = await json<any>(await callRoute(asRoute(getStatus), {}))

    expect(body.job_summary).toEqual(health.job_summary)
  })
})
