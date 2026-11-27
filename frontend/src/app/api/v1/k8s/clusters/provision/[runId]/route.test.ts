import { describe, it, expect, vi, beforeEach } from 'vitest'
import { callRoute, readJson } from '@/__tests__/setup/route-test'

const requireK8sProvisionMock = vi.fn()
const resolveStrictTenantMock = vi.fn()
const getProvisionRunMock = vi.fn()

vi.mock('@/lib/k8s/requireK8sProvision', () => ({ requireK8sProvision: (...a: any[]) => requireK8sProvisionMock(...a) }))
vi.mock('@/lib/k8s/strictTenant', () => ({ resolveStrictTenant: (...a: any[]) => resolveStrictTenantMock(...a) }))
vi.mock('@/lib/k8s/provisionOrchestrator', () => ({ getProvisionRun: (...a: any[]) => getProvisionRunMock(...a) }))

beforeEach(() => {
  requireK8sProvisionMock.mockReset().mockResolvedValue(null)
  resolveStrictTenantMock.mockReset().mockResolvedValue({ ok: true, tenantId: 't1' })
  getProvisionRunMock.mockReset()
})

describe('GET /api/v1/k8s/clusters/provision/[runId]', () => {
  it('403 when the guard denies', async () => {
    requireK8sProvisionMock.mockResolvedValue(new Response('no', { status: 403 }))
    const GET = (await import('./route')).GET
    const res = await callRoute(GET, { params: { runId: 'run-1' }, method: 'GET' })
    expect(res.status).toBe(403)
    expect(getProvisionRunMock).not.toHaveBeenCalled()
  })

  it('403 when tenant invalid', async () => {
    resolveStrictTenantMock.mockResolvedValue({ ok: false, response: new Response('no', { status: 403 }) })
    const GET = (await import('./route')).GET
    const res = await callRoute(GET, { params: { runId: 'run-1' }, method: 'GET' })
    expect(res.status).toBe(403)
  })

  it('proxies the run status verbatim on success (pure read, no mutation)', async () => {
    const value = { run: { id: 'run-1', status: 'running', phase: 'provisioning', progress: 40 } }
    getProvisionRunMock.mockResolvedValue({ ok: true, value })
    const GET = (await import('./route')).GET
    const res = await callRoute(GET, { params: { runId: 'run-1' }, method: 'GET' })
    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual(value)
    expect(getProvisionRunMock).toHaveBeenCalledWith('run-1')
  })

  it('proxies outputs when completed', async () => {
    const value = {
      run: { id: 'run-1', status: 'completed', phase: 'done', progress: 100 },
      outputs: { kubeconfig: 'kc', talosconfig: 'tc', nodes: [{ name: 'cp-1', role: 'controlplane', vmid: 100, ip: '10.0.0.10' }] },
    }
    getProvisionRunMock.mockResolvedValue({ ok: true, value })
    const GET = (await import('./route')).GET
    const res = await callRoute(GET, { params: { runId: 'run-1' }, method: 'GET' })
    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual(value)
    // Outputs carry the kubeconfig/talosconfig: must not be cached.
    expect(res.headers.get('Cache-Control')).toBe('no-store')
  })

  it('maps "Orchestrator 404" to 404', async () => {
    getProvisionRunMock.mockResolvedValue({ ok: false, error: 'Orchestrator 404: run not found' })
    const GET = (await import('./route')).GET
    const res = await callRoute(GET, { params: { runId: 'missing' }, method: 'GET' })
    expect(res.status).toBe(404)
  })

  it('maps an unrecognized failure to 502', async () => {
    getProvisionRunMock.mockResolvedValue({ ok: false, error: 'Orchestrator unavailable' })
    const GET = (await import('./route')).GET
    const res = await callRoute(GET, { params: { runId: 'run-1' }, method: 'GET' })
    expect(res.status).toBe(502)
  })
})
