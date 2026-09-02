import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const getCurrentTenantIdMock = vi.fn<() => Promise<string | null>>()
const DEFAULT_TENANT_ID = 'default'

vi.mock('@/lib/tenant', () => ({
  getCurrentTenantId: getCurrentTenantIdMock,
  DEFAULT_TENANT_ID,
}))

function jsonResponse(body: unknown, init: Partial<{ ok: boolean; status: number }> = {}) {
  return {
    ok: init.ok ?? true,
    status: init.status ?? 200,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }
}

function textErrorResponse(status: number, body: string) {
  return {
    ok: false,
    status,
    json: async () => ({}),
    text: async () => body,
  }
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  getCurrentTenantIdMock.mockReset()
  getCurrentTenantIdMock.mockResolvedValue(null)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('orchestratorFetch', () => {
  it('builds the URL by prefixing /api/v1 and uses GET by default', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }))

    const { orchestratorFetch } = await import('./client')
    const result = await orchestratorFetch<{ ok: boolean }>('/drs/status')

    expect(result).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:8080/api/v1/drs/status')
    expect(init.method).toBe('GET')
    expect(init.headers['Content-Type']).toBe('application/json')
    expect(init.body).toBeUndefined()
    expect(init.cache).toBe('no-store')
  })

  it('serialises the body for POST and sets the method', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'r1' }))

    const { orchestratorFetch } = await import('./client')
    await orchestratorFetch('/rules', { method: 'POST', body: { name: 'pin-db' } })

    const [, init] = fetchMock.mock.calls[0]
    expect(init.method).toBe('POST')
    expect(init.body).toBe(JSON.stringify({ name: 'pin-db' }))
  })

  it('forwards the tenant header when the current tenant is not the default', async () => {
    getCurrentTenantIdMock.mockResolvedValueOnce('tenant-42')
    fetchMock.mockResolvedValueOnce(jsonResponse({}))

    const { orchestratorFetch } = await import('./client')
    await orchestratorFetch('/metrics')

    const [, init] = fetchMock.mock.calls[0]
    expect(init.headers['X-Tenant-ID']).toBe('tenant-42')
  })

  it('omits the tenant header for the default (provider) tenant', async () => {
    getCurrentTenantIdMock.mockResolvedValueOnce(DEFAULT_TENANT_ID)
    fetchMock.mockResolvedValueOnce(jsonResponse({}))

    const { orchestratorFetch } = await import('./client')
    await orchestratorFetch('/metrics')

    const [, init] = fetchMock.mock.calls[0]
    expect(init.headers['X-Tenant-ID']).toBeUndefined()
  })

  it('still issues the request when tenant resolution throws (background job context)', async () => {
    getCurrentTenantIdMock.mockRejectedValueOnce(new Error('no session'))
    fetchMock.mockResolvedValueOnce(jsonResponse({}))

    const { orchestratorFetch } = await import('./client')
    await orchestratorFetch('/health')

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [, init] = fetchMock.mock.calls[0]
    expect(init.headers['X-Tenant-ID']).toBeUndefined()
  })

  it('raises Error with status and body when the response is not ok', async () => {
    fetchMock.mockResolvedValueOnce(textErrorResponse(404, 'rule not found'))

    const { orchestratorFetch } = await import('./client')
    await expect(orchestratorFetch('/rules/missing')).rejects.toThrow(
      'Orchestrator 404: rule not found',
    )
  })

  it('tags ECONNREFUSED as ORCHESTRATOR_UNAVAILABLE so callers can downgrade quietly', async () => {
    const connErr: any = new Error('fetch failed')
    connErr.cause = { code: 'ECONNREFUSED' }
    fetchMock.mockRejectedValueOnce(connErr)

    const { orchestratorFetch } = await import('./client')
    await expect(orchestratorFetch('/health')).rejects.toMatchObject({
      message: 'Orchestrator unavailable',
      code: 'ORCHESTRATOR_UNAVAILABLE',
    })
  })

  it('tags ENOTFOUND as ORCHESTRATOR_UNAVAILABLE', async () => {
    const connErr: any = new Error('fetch failed')
    connErr.cause = { code: 'ENOTFOUND' }
    fetchMock.mockRejectedValueOnce(connErr)

    const { orchestratorFetch } = await import('./client')
    await expect(orchestratorFetch('/health')).rejects.toMatchObject({
      code: 'ORCHESTRATOR_UNAVAILABLE',
    })
  })

  it('re-throws unknown errors verbatim instead of swallowing them', async () => {
    fetchMock.mockRejectedValueOnce(new Error('TLS handshake failed'))

    const { orchestratorFetch } = await import('./client')
    await expect(orchestratorFetch('/health')).rejects.toThrow('TLS handshake failed')
  })

  it('translates AbortError to a timeout message', async () => {
    const abortErr = new Error('aborted')
    abortErr.name = 'AbortError'
    fetchMock.mockRejectedValueOnce(abortErr)

    const { orchestratorFetch } = await import('./client')
    await expect(orchestratorFetch('/slow')).rejects.toThrow('Orchestrator request timeout')
  })
})

describe('OrchestratorClient axios-style wrapper', () => {
  it('get returns { data, status: 200 }', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ enabled: true }))

    const { getOrchestratorClient } = await import('./client')
    const res = await getOrchestratorClient().get<{ enabled: boolean }>('/drs/status')

    expect(res).toEqual({ data: { enabled: true }, status: 200 })
  })

  it('post forwards the body and uses POST', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: 'accepted' }))

    const { getOrchestratorClient } = await import('./client')
    await getOrchestratorClient().post('/drs/recommendations/r1/approve', { note: 'ok' })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:8080/api/v1/drs/recommendations/r1/approve')
    expect(init.method).toBe('POST')
    expect(init.body).toBe(JSON.stringify({ note: 'ok' }))
  })

  it('testSSHConnection hits /connections/<id>/test-ssh with POST', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, nodes: [] }))

    const { getOrchestratorClient } = await import('./client')
    await getOrchestratorClient().testSSHConnection('conn-abc')

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:8080/api/v1/connections/conn-abc/test-ssh')
    expect(init.method).toBe('POST')
  })

  it('getMetricsHistory builds the right query string', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]))

    const { getOrchestratorClient } = await import('./client')
    await getOrchestratorClient().getMetricsHistory('conn-1', '2026-01-01', '2026-01-02')

    const [url] = fetchMock.mock.calls[0]
    expect(url).toBe(
      'http://localhost:8080/api/v1/metrics/conn-1/history?from=2026-01-01&to=2026-01-02',
    )
  })

  it('getMetricsHistory omits the query string when neither from nor to are set', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]))

    const { getOrchestratorClient } = await import('./client')
    await getOrchestratorClient().getMetricsHistory('conn-1')

    const [url] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:8080/api/v1/metrics/conn-1/history')
  })

  it('listMirrorSnapshots hits /replication/snapshots with GET and no query string by default', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]))

    const { getOrchestratorClient } = await import('./client')
    await getOrchestratorClient().listMirrorSnapshots()

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:8080/api/v1/replication/snapshots')
    expect(init.method).toBe('GET')
  })

  it('listMirrorSnapshots forwards the cluster_id filter', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]))

    const { getOrchestratorClient } = await import('./client')
    await getOrchestratorClient().listMirrorSnapshots({ clusterId: 'conn-1' })

    const [url] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:8080/api/v1/replication/snapshots?cluster_id=conn-1')
  })

  it('listMirrorSnapshots forwards the vmid filter', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]))

    const { getOrchestratorClient } = await import('./client')
    await getOrchestratorClient().listMirrorSnapshots({ vmid: 100 })

    const [url] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:8080/api/v1/replication/snapshots?vmid=100')
  })

  it('listMirrorSnapshots forwards both filters and keeps a zero vmid', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]))

    const { getOrchestratorClient } = await import('./client')
    await getOrchestratorClient().listMirrorSnapshots({ clusterId: 'conn-1', vmid: 0 })

    const [url] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:8080/api/v1/replication/snapshots?cluster_id=conn-1&vmid=0')
  })

  it('listMirrorSnapshots omits the query string for an empty cluster_id', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]))

    const { getOrchestratorClient } = await import('./client')
    await getOrchestratorClient().listMirrorSnapshots({ clusterId: '' })

    const [url] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:8080/api/v1/replication/snapshots')
  })

  it('getRecommendations toggles the validate query flag', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]))

    const { getOrchestratorClient } = await import('./client')
    await getOrchestratorClient().getRecommendations(true)

    const [url] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:8080/api/v1/drs/recommendations?validate=true')
  })

  it('getPlanRestorePoints hits /replication/plans/<id>/restore-points with GET', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ vms: [] }))

    const { getOrchestratorClient } = await import('./client')
    await getOrchestratorClient().getPlanRestorePoints('plan-1')

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:8080/api/v1/replication/plans/plan-1/restore-points')
    expect(init.method).toBe('GET')
  })

  it('executeFailover forwards the restore_points body on POST', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'exec-1' }))

    const { getOrchestratorClient } = await import('./client')
    await getOrchestratorClient().executeFailover('plan-1', { restore_points: { 100: 'snap-1' } })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:8080/api/v1/replication/plans/plan-1/failover')
    expect(init.method).toBe('POST')
    expect(init.body).toBe(JSON.stringify({ restore_points: { 100: 'snap-1' } }))
  })

  it('failbackCutover hits /replication/plans/<id>/failback-cutover with POST', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: 'cutover_started' }))

    const { getOrchestratorClient } = await import('./client')
    await getOrchestratorClient().failbackCutover('plan-1')

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:8080/api/v1/replication/plans/plan-1/failback-cutover')
    expect(init.method).toBe('POST')
  })

  it('failbackCancel hits /replication/plans/<id>/failback-cancel with POST', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: 'cancelled' }))

    const { getOrchestratorClient } = await import('./client')
    await getOrchestratorClient().failbackCancel('plan-1')

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:8080/api/v1/replication/plans/plan-1/failback-cancel')
    expect(init.method).toBe('POST')
  })

  it('clearRecoveryHistory hits /replication/plans/<id>/history with DELETE', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ deleted: 3 }))

    const { getOrchestratorClient } = await import('./client')
    await getOrchestratorClient().clearRecoveryHistory('plan-1')

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:8080/api/v1/replication/plans/plan-1/history')
    expect(init.method).toBe('DELETE')
  })

  it('getExecutionScreenshots hits /replication/executions/<id>/screenshots with GET', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]))

    const { getOrchestratorClient } = await import('./client')
    await getOrchestratorClient().getExecutionScreenshots('exec-1')

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:8080/api/v1/replication/executions/exec-1/screenshots')
    expect(init.method).toBe('GET')
  })
})

describe('parseOrchestratorError', () => {
  it('returns null when the error message does not match the Orchestrator <status>: <body> shape', async () => {
    const { parseOrchestratorError } = await import('./client')

    expect(parseOrchestratorError(new Error('TLS handshake failed'))).toBeNull()
    expect(parseOrchestratorError('a plain string')).toBeNull()
    expect(parseOrchestratorError(undefined)).toBeNull()
  })

  it('extracts the status and message from a JSON error body', async () => {
    const { parseOrchestratorError } = await import('./client')
    const error = new Error(`Orchestrator 409: ${JSON.stringify({ error: 'a failback is already in progress' })}`)

    expect(parseOrchestratorError(error)).toEqual({ status: 409, message: 'a failback is already in progress' })
  })

  it('falls back to the raw body text when the JSON has no error field', async () => {
    const { parseOrchestratorError } = await import('./client')
    const error = new Error(`Orchestrator 500: ${JSON.stringify({ code: 'internal' })}`)

    expect(parseOrchestratorError(error)).toEqual({ status: 500, message: JSON.stringify({ code: 'internal' }) })
  })

  it('falls back to the raw body text when the body is not JSON', async () => {
    const { parseOrchestratorError } = await import('./client')
    const error = new Error('Orchestrator 502: bad gateway upstream')

    expect(parseOrchestratorError(error)).toEqual({ status: 502, message: 'bad gateway upstream' })
  })

  it('falls back to a generic message when the body is empty', async () => {
    const { parseOrchestratorError } = await import('./client')
    const error = new Error('Orchestrator 503: ')

    expect(parseOrchestratorError(error)).toEqual({ status: 503, message: 'Orchestrator error 503' })
  })
})

describe('leader routing (ui#803 defect 2)', () => {
  const ORIG = process.env.ORCHESTRATOR_LEADER_URL

  afterEach(() => {
    if (ORIG === undefined) delete process.env.ORCHESTRATOR_LEADER_URL
    else process.env.ORCHESTRATOR_LEADER_URL = ORIG
    vi.resetModules()
  })

  async function fetchPathWithLeaderUrl(path: string, leaderUrl?: string) {
    if (leaderUrl === undefined) delete process.env.ORCHESTRATOR_LEADER_URL
    else process.env.ORCHESTRATOR_LEADER_URL = leaderUrl
    vi.resetModules()
    const localFetch = vi.fn().mockResolvedValue(jsonResponse({ ok: true }))
    vi.stubGlobal('fetch', localFetch)
    const { orchestratorFetch } = await import('./client')
    await orchestratorFetch(path)
    return localFetch.mock.calls[0][0] as string
  }

  it('routes /metrics and /drs to the leader URL when set', async () => {
    const leader = 'http://127.0.0.1:8081'
    expect(await fetchPathWithLeaderUrl('/metrics', leader)).toBe(`${leader}/api/v1/metrics`)
    expect(await fetchPathWithLeaderUrl('/metrics/abc/history', leader)).toBe(`${leader}/api/v1/metrics/abc/history`)
    expect(await fetchPathWithLeaderUrl('/drs/status', leader)).toBe(`${leader}/api/v1/drs/status`)
    expect(await fetchPathWithLeaderUrl('/drs/recommendations?validate=true', leader)).toBe(`${leader}/api/v1/drs/recommendations?validate=true`)
  })

  it('keeps non-leader endpoints on the local orchestrator', async () => {
    const leader = 'http://127.0.0.1:8081'
    expect(await fetchPathWithLeaderUrl('/health', leader)).toBe('http://localhost:8080/api/v1/health')
    expect(await fetchPathWithLeaderUrl('/rolling-updates', leader)).toBe('http://localhost:8080/api/v1/rolling-updates')
    expect(await fetchPathWithLeaderUrl('/rules', leader)).toBe('http://localhost:8080/api/v1/rules')
    expect(await fetchPathWithLeaderUrl('/ha/cluster', leader)).toBe('http://localhost:8080/api/v1/ha/cluster')
  })

  it('falls back to the local orchestrator for /drs when no leader URL is set (non-HA)', async () => {
    expect(await fetchPathWithLeaderUrl('/drs/status', undefined)).toBe('http://localhost:8080/api/v1/drs/status')
  })
})
