import { describe, it, expect, vi, beforeEach } from 'vitest'
import { callRoute, readJson } from '@/__tests__/setup/route-test'

const requireK8sProvisionMock = vi.fn()
const resolveStrictTenantMock = vi.fn()
const getProvisionLogsMock = vi.fn()

vi.mock('@/lib/k8s/requireK8sProvision', () => ({ requireK8sProvision: (...a: any[]) => requireK8sProvisionMock(...a) }))
vi.mock('@/lib/k8s/strictTenant', () => ({ resolveStrictTenant: (...a: any[]) => resolveStrictTenantMock(...a) }))
vi.mock('@/lib/k8s/provisionOrchestrator', () => ({ getProvisionLogs: (...a: any[]) => getProvisionLogsMock(...a) }))

beforeEach(() => {
  requireK8sProvisionMock.mockReset().mockResolvedValue(null)
  resolveStrictTenantMock.mockReset().mockResolvedValue({ ok: true, tenantId: 't1' })
  getProvisionLogsMock.mockReset().mockResolvedValue({ ok: true, value: { logs: [] } })
})

describe('GET /api/v1/k8s/clusters/provision/[runId]/logs', () => {
  it('403 when the guard denies', async () => {
    requireK8sProvisionMock.mockResolvedValue(new Response('no', { status: 403 }))
    const GET = (await import('./route')).GET
    const res = await callRoute(GET, { params: { runId: 'run-1' }, method: 'GET' })
    expect(res.status).toBe(403)
    expect(getProvisionLogsMock).not.toHaveBeenCalled()
  })

  it('403 when tenant invalid', async () => {
    resolveStrictTenantMock.mockResolvedValue({ ok: false, response: new Response('no', { status: 403 }) })
    const GET = (await import('./route')).GET
    const res = await callRoute(GET, { params: { runId: 'run-1' }, method: 'GET' })
    expect(res.status).toBe(403)
  })

  it('defaults limit to 0 when the query param is absent', async () => {
    const GET = (await import('./route')).GET
    await callRoute(GET, { params: { runId: 'run-1' }, method: 'GET' })
    expect(getProvisionLogsMock).toHaveBeenCalledWith('run-1', 0)
  })

  it('parses the ?limit= query param as a number', async () => {
    const GET = (await import('./route')).GET
    await callRoute(GET, { params: { runId: 'run-1' }, method: 'GET', searchParams: { limit: '50' } })
    expect(getProvisionLogsMock).toHaveBeenCalledWith('run-1', 50)
  })

  it('proxies the logs verbatim on success', async () => {
    const value = { logs: [{ level: 'info', message: 'starting', createdAt: '2026-07-02T00:00:00Z' }] }
    getProvisionLogsMock.mockResolvedValue({ ok: true, value })
    const GET = (await import('./route')).GET
    const res = await callRoute(GET, { params: { runId: 'run-1' }, method: 'GET' })
    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual(value)
  })

  it('maps "Orchestrator 404" to 404', async () => {
    getProvisionLogsMock.mockResolvedValue({ ok: false, error: 'Orchestrator 404: run not found' })
    const GET = (await import('./route')).GET
    const res = await callRoute(GET, { params: { runId: 'missing' }, method: 'GET' })
    expect(res.status).toBe(404)
  })

  it('maps an unrecognized failure to 502', async () => {
    getProvisionLogsMock.mockResolvedValue({ ok: false, error: 'Orchestrator unavailable' })
    const GET = (await import('./route')).GET
    const res = await callRoute(GET, { params: { runId: 'run-1' }, method: 'GET' })
    expect(res.status).toBe(502)
  })
})
