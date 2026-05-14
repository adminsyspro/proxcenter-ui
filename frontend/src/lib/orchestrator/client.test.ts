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

  it('getRecommendations toggles the validate query flag', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse([]))

    const { getOrchestratorClient } = await import('./client')
    await getOrchestratorClient().getRecommendations(true)

    const [url] = fetchMock.mock.calls[0]
    expect(url).toBe('http://localhost:8080/api/v1/drs/recommendations?validate=true')
  })
})
