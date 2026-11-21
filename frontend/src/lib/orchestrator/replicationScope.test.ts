import { beforeEach, describe, expect, it, vi } from 'vitest'

const { tenantIdMock, connectionIdsMock } = vi.hoisted(() => ({
  tenantIdMock: vi.fn(),
  connectionIdsMock: vi.fn(),
}))

vi.mock('@/lib/tenant', () => ({
  DEFAULT_TENANT_ID: 'default',
  getCurrentTenantId: tenantIdMock,
  getTenantConnectionIds: connectionIdsMock,
}))

import {
  connectionUsers,
  getReplicationScope,
  missingConnections,
  scopeReplicationItem,
  itemForAction,
  scopeReplicationItems,
  summarizeReplicationJobs,
} from './replicationScope'

const provider = { connectionIds: new Set(['prod', 'dr']), showOrphans: true }
const tenant = { connectionIds: new Set(['prod', 'dr']), showOrphans: false }

beforeEach(() => {
  vi.clearAllMocks()
})

describe('getReplicationScope', () => {
  it('shows orphans to the provider, whose connection set is the whole fleet', async () => {
    tenantIdMock.mockResolvedValue('default')
    connectionIdsMock.mockResolvedValue(new Set(['prod']))

    const scope = await getReplicationScope()

    expect(scope.showOrphans).toBe(true)
    expect([...scope.connectionIds]).toEqual(['prod'])
  })

  it('never shows orphans to a tenant: a missing id may be another tenant connection', async () => {
    tenantIdMock.mockResolvedValue('acme')
    connectionIdsMock.mockResolvedValue(new Set(['prod']))

    expect((await getReplicationScope()).showOrphans).toBe(false)
  })
})

describe('missingConnections', () => {
  it('names the ends whose connection is not in the set', () => {
    expect(missingConnections({ source_cluster: 'prod', target_cluster: 'gone' }, provider.connectionIds)).toEqual(['target'])
    expect(missingConnections({ source_cluster: 'gone', target_cluster: 'gone2' }, provider.connectionIds)).toEqual(['source', 'target'])
    expect(missingConnections({ source_cluster: 'prod', target_cluster: 'dr' }, provider.connectionIds)).toEqual([])
  })

  it('ignores an empty end', () => {
    expect(missingConnections({ source_cluster: '', target_cluster: null }, provider.connectionIds)).toEqual([])
  })
})

describe('scopeReplicationItem', () => {
  it('returns a job on known connections unchanged', () => {
    const job = { id: 'a', source_cluster: 'prod', target_cluster: 'dr' }

    expect(scopeReplicationItem(job, provider)).toBe(job)
  })

  it('flags a job on a deleted connection for the provider', () => {
    const job = { id: 'b', source_cluster: 'prod', target_cluster: 'gone' }

    expect(scopeReplicationItem(job, provider)).toEqual({ ...job, missing_connections: ['target'] })
  })

  it('hides a job on a connection outside the tenant', () => {
    expect(scopeReplicationItem({ id: 'c', source_cluster: 'prod', target_cluster: 'other' }, tenant)).toBeNull()
  })

  it('hides nothing when the item is absent', () => {
    expect(scopeReplicationItem(null, provider)).toBeNull()
  })
})

describe('scopeReplicationItems', () => {
  it('keeps visible jobs and flagged orphans in order, drops foreign ones', () => {
    const jobs = [
      { id: 'a', source_cluster: 'prod', target_cluster: 'dr' },
      { id: 'b', source_cluster: 'prod', target_cluster: 'gone' },
    ]

    expect(scopeReplicationItems(jobs, provider).map(j => [j.id, j.missing_connections])).toEqual([
      ['a', undefined],
      ['b', ['target']],
    ])
    expect(scopeReplicationItems(jobs, tenant).map(j => j.id)).toEqual(['a'])
  })

  it('treats a non-array response as empty', () => {
    expect(scopeReplicationItems(undefined, provider)).toEqual([])
  })
})

describe('summarizeReplicationJobs', () => {
  it('counts each status the way the orchestrator dashboard does', () => {
    const summary = summarizeReplicationJobs([
      { status: 'synced' }, { status: 'synced' }, { status: 'error' }, { status: 'partial' },
      { status: 'syncing' }, { status: 'pending' }, { status: 'paused' }, { status: 'no_match' },
      { status: 'failed_over' },
    ])

    expect(summary).toEqual({
      job_summary: { synced: 2, syncing: 1, pending: 1, error: 1, paused: 1, no_match: 1, partial: 1 },
      error_count: 2,
      total_jobs: 9,
    })
  })
})

describe('connectionUsers', () => {
  it('lists the jobs and plans that replicate from or to a connection', () => {
    const users = connectionUsers('dr', {
      jobs: [
        { id: 'j1', name: 'Web', source_cluster: 'prod', target_cluster: 'dr' },
        { id: 'j2', name: '', source_cluster: 'dr', target_cluster: 'prod' },
        { id: 'j3', name: 'Other', source_cluster: 'prod', target_cluster: 'dr2' },
      ],
      plans: [{ id: 'p1', name: 'Critical', source_cluster: 'prod', target_cluster: 'dr' }],
    })

    expect(users).toEqual({ jobs: ['Web', 'j2'], plans: ['Critical'] })
  })

  it('tolerates missing lists', () => {
    expect(connectionUsers('dr', { jobs: undefined, plans: null })).toEqual({ jobs: [], plans: [] })
  })
})

describe('itemForAction', () => {
  const orphan = { id: 'b', source_cluster: 'prod', target_cluster: 'gone' }

  it('lets an orphan through only where allowed', () => {
    expect(itemForAction(orphan, provider, { allowOrphan: true })?.missing_connections).toEqual(['target'])
    expect(itemForAction(orphan, provider, { allowOrphan: false })).toBeNull()
  })

  it('always lets a job on known connections through', () => {
    const job = { id: 'a', source_cluster: 'prod', target_cluster: 'dr' }

    expect(itemForAction(job, tenant, { allowOrphan: false })).toBe(job)
  })
})
