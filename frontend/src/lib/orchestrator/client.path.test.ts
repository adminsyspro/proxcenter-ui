import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/tenant', () => ({ getCurrentTenantId: async () => 'default', DEFAULT_TENANT_ID: 'default' }))
vi.mock('./actor', () => ({ actorHeaders: async () => ({}) }))

import { alertsApi, eventRulesApi, getOrchestratorClient, orchestratorFetch, orchestratorPath, OrchestratorPathError, orchestratorSegment, parseOrchestratorError } from './client'

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset().mockImplementation(async () => new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const calledPath = () => new URL(fetchMock.mock.calls[0][0] as string).pathname

describe('orchestratorSegment', () => {
  it('accepts the identifiers the orchestrator hands out', () => {
    for (const id of ['3f1c8a52-1b2c-4d5e-8f90-123456789abc', 'cmtk6kkex000d7zjlt3abo6e4', '100', 'rule_7', 'top-talkers', 'a.b']) {
      expect(orchestratorSegment(id), id).toBe(id)
    }
    expect(orchestratorSegment(42)).toBe('42')
  })

  it('refuses anything that could be read as more than one segment or as another path', () => {
    for (const id of ['../health', '..%2F..%2Fhealth', 'a/b', 'a?x=1', 'a#f', '.', '..', '', ' ', 'a b', 'a%2Fb', '-leading', '.hidden', 'é', 'x'.repeat(129)]) {
      expect(() => orchestratorSegment(id), JSON.stringify(id)).toThrow(OrchestratorPathError)
    }
    expect(() => orchestratorSegment(undefined)).toThrow(OrchestratorPathError)
    expect(() => orchestratorSegment(Number.NaN)).toThrow(OrchestratorPathError)
    expect(() => orchestratorSegment({ toString: () => 'x' })).toThrow(OrchestratorPathError)
  })
})

describe('orchestratorPath', () => {
  it('builds a path from validated segments', () => {
    expect(orchestratorPath`/reports/${'rep-1'}/download`).toBe('/reports/rep-1/download')
    expect(orchestratorPath`/replication/jobs/${'job-1'}/vms/${107}/reseed`).toBe('/replication/jobs/job-1/vms/107/reseed')
  })

  it('throws before anything is sent when a segment is refused', () => {
    expect(() => orchestratorPath`/reports/${'../health'}`).toThrow(OrchestratorPathError)
    expect(() => orchestratorPath`/alerts/rules/${'..%2F..%2Fhealth'}`).toThrow(OrchestratorPathError)
  })
})

describe('orchestratorFetch path net', () => {
  it('refuses a dot segment, an empty segment or an encoded separator in a hand-built path', async () => {
    for (const path of ['/reports/../health', '/reports/./x', '/reports//x', '/reports/a%2Fb', '/reports/a%2fb/download', 'reports/x']) {
      await expect(orchestratorFetch(path), path).rejects.toBeInstanceOf(OrchestratorPathError)
    }
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('still sends a plain path with its query string', async () => {
    await orchestratorFetch('/reports?limit=10&offset=0')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toMatch(/\/api\/v1\/reports\?limit=10&offset=0$/)
  })
})

describe('typed client methods', () => {
  it('encode the id of every id-bearing call and refuse a traversal before any request', async () => {
    const client = getOrchestratorClient()
    const calls: Array<[string, () => Promise<unknown>]> = [
      ['/api/v1/alerts/rules/r-1', () => eventRulesApi.getRule('r-1')],
      ['/api/v1/alerts/a-1/acknowledge', () => alertsApi.acknowledge('a-1', 'me')],
      ['/api/v1/replication/jobs/j-1/sync', () => client.syncReplicationJob('j-1')],
      ['/api/v1/replication/plans/p-1/guests/107/failover', () => client.guestFailover('p-1', 107)],
      ['/api/v1/replication/executions/e-1/events', () => client.getExecutionEvents('e-1', 3)],
      ['/api/v1/metrics/c-1/history', () => client.getMetricsHistory('c-1', '2026-10-25')],
      ['/api/v1/drs/recommendations/rec-1/approve', () => client.approveRecommendation('rec-1')],
      ['/api/v1/connections/c-1/test-ssh', () => client.testSSHConnection('c-1')],
    ]
    for (const [expected, run] of calls) {
      fetchMock.mockClear()
      await run()
      expect(calledPath(), expected).toBe(expected)
    }

    for (const run of [
      () => eventRulesApi.getRule('../health'),
      () => alertsApi.getAlert('..%2F..%2Fhealth'),
      () => client.getReplicationJob('a/b'),
      () => client.getRecoveryPlan('x?y=1'),
      () => client.getMetrics('c 1'),
    ]) {
      fetchMock.mockClear()
      // The path is built before the call: a sync method throws, an async one rejects.
      await expect((async () => run())()).rejects.toBeInstanceOf(OrchestratorPathError)
      expect(fetchMock).not.toHaveBeenCalled()
    }
  })

  it('puts a connection id in the query through URLSearchParams', async () => {
    await alertsApi.getActiveAlerts('c-1&x=2')
    const url = new URL(fetchMock.mock.calls[0][0] as string)
    expect(url.pathname).toBe('/api/v1/alerts/active')
    expect(url.searchParams.get('connection_id')).toBe('c-1&x=2')
    expect(url.searchParams.has('x')).toBe(false)
  })
})

describe('every id-bearing client method', () => {
  const client = getOrchestratorClient()
  // [call with a valid id, expected upstream path, same call with a forged id]
  const cases: [string, (id: string) => unknown, string][] = [
    ['rejectRecommendation', id => client.rejectRecommendation(id), '/api/v1/drs/recommendations/ok-1/reject'],
    ['executeRecommendation', id => client.executeRecommendation(id), '/api/v1/drs/recommendations/ok-1/execute'],
    ['updateRule', id => client.updateRule(id, {}), '/api/v1/rules/ok-1'],
    ['deleteRule', id => client.deleteRule(id), '/api/v1/rules/ok-1'],
    ['getTopGuests', id => client.getTopGuests(id, { metric: 'cpu' }), '/api/v1/metrics/ok-1/top'],
    ['getClusterNodes', id => client.getClusterNodes(id), '/api/v1/clusters/ok-1/nodes'],
    ['getClusterVMs', id => client.getClusterVMs(id), '/api/v1/clusters/ok-1/vms'],
    ['updateReplicationJob', id => client.updateReplicationJob(id, {}), '/api/v1/replication/jobs/ok-1'],
    ['deleteReplicationJob', id => client.deleteReplicationJob(id), '/api/v1/replication/jobs/ok-1'],
    ['pauseReplicationJob', id => client.pauseReplicationJob(id), '/api/v1/replication/jobs/ok-1/pause'],
    ['resumeReplicationJob', id => client.resumeReplicationJob(id), '/api/v1/replication/jobs/ok-1/resume'],
    ['cancelReplicationJob', id => client.cancelReplicationJob(id), '/api/v1/replication/jobs/ok-1/cancel'],
    ['cancelRecoveryExecution', id => client.cancelRecoveryExecution(id), '/api/v1/replication/executions/ok-1/cancel'],
    ['getReplicationJobLogs', id => client.getReplicationJobLogs(id), '/api/v1/replication/jobs/ok-1/logs'],
    ['getReplicationJobVMs', id => client.getReplicationJobVMs(id), '/api/v1/replication/jobs/ok-1/vms'],
    ['reseedReplicationJobVM', id => client.reseedReplicationJobVM(id, 100), '/api/v1/replication/jobs/ok-1/vms/100/reseed'],
    ['getReplicationJobThroughput', id => client.getReplicationJobThroughput(id, '1h'), '/api/v1/replication/jobs/ok-1/throughput'],
    ['updateRecoveryPlan', id => client.updateRecoveryPlan(id, {}), '/api/v1/replication/plans/ok-1'],
    ['deleteRecoveryPlan', id => client.deleteRecoveryPlan(id), '/api/v1/replication/plans/ok-1'],
    ['testFailover', id => client.testFailover(id), '/api/v1/replication/plans/ok-1/test-failover'],
    ['executeFailback', id => client.executeFailback(id), '/api/v1/replication/plans/ok-1/failback'],
    ['cleanupTestFailover', id => client.cleanupTestFailover(id), '/api/v1/replication/plans/ok-1/cleanup-test'],
    ['getRecoveryHistory', id => client.getRecoveryHistory(id), '/api/v1/replication/plans/ok-1/history'],
    ['getExecution', id => client.getExecution(id), '/api/v1/replication/executions/ok-1'],
    ['getRestoreDrill', id => client.getRestoreDrill(id), '/api/v1/restore-drills/ok-1'],
    ['cancelRestoreDrill', id => client.cancelRestoreDrill(id), '/api/v1/restore-drills/ok-1/cancel'],
    ['cleanupRestoreDrill', id => client.cleanupRestoreDrill(id), '/api/v1/restore-drills/ok-1/cleanup'],
    ['alertsApi.resolve', id => alertsApi.resolve(id), '/api/v1/alerts/ok-1/resolve'],
    ['alertsApi.deleteAlert', id => alertsApi.deleteAlert(id), '/api/v1/alerts/ok-1'],
    ['eventRulesApi.updateRule', id => eventRulesApi.updateRule(id, {}), '/api/v1/alerts/rules/ok-1'],
    ['eventRulesApi.deleteRule', id => eventRulesApi.deleteRule(id), '/api/v1/alerts/rules/ok-1'],
    ['eventRulesApi.toggleRule', id => eventRulesApi.toggleRule(id), '/api/v1/alerts/rules/ok-1/toggle'],
  ]

  it.each(cases)('%s targets its own path', async (_name, call, path) => {
    await call('ok-1')
    expect(calledPath()).toBe(path)
  })

  it.each(cases)('%s refuses a forged id before any call', async (_name, call) => {
    await expect((async () => call('../health'))()).rejects.toBeInstanceOf(OrchestratorPathError)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('keeps optional connection filters in the query string', async () => {
    await client.getMigrations(5)
    expect(new URL(fetchMock.mock.calls[0][0] as string).searchParams.get('limit')).toBe('5')
    fetchMock.mockClear()
    await alertsApi.getSummary('c-1')
    expect(new URL(fetchMock.mock.calls[0][0] as string).searchParams.get('connection_id')).toBe('c-1')
    fetchMock.mockClear()
    await alertsApi.clearAll('c-1')
    expect(new URL(fetchMock.mock.calls[0][0] as string).searchParams.get('connection_id')).toBe('c-1')
  })
})

describe('parseOrchestratorError', () => {
  it('maps a refused path to a 400 for the relays', () => {
    expect(parseOrchestratorError(new OrchestratorPathError('Invalid id'))).toEqual({ status: 400, message: 'Invalid id' })
  })
})
