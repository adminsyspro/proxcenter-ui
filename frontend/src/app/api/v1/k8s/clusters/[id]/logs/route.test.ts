import { describe, it, expect, vi, beforeEach } from 'vitest'
import { callRoute, readJson } from '@/__tests__/setup/route-test'

const gateMock = vi.fn()
const logsMock = vi.fn()
const auditMock = vi.fn()
vi.mock('@/lib/k8s/requireK8sViewCluster', () => ({ requireK8sViewCluster: (...a: any[]) => gateMock(...a) }))
vi.mock('@/lib/k8s/orchestrator', () => ({ fetchPodLogs: (...a: any[]) => logsMock(...a) }))
vi.mock('@/lib/audit', () => ({ audit: (...a: any[]) => auditMock(...a) }))

beforeEach(() => {
  gateMock.mockReset().mockResolvedValue({ ok: true, tenantId: 't1', cluster: { id: 'c1', name: 'dev', credentialVersion: 3 }, credential: {} })
  logsMock.mockReset().mockResolvedValue({ ok: true, value: { container: 'app', logs: 'line', truncated: false } })
  auditMock.mockReset().mockResolvedValue('a1')
})

describe('GET logs', () => {
  it('403 when gate denies', async () => {
    gateMock.mockResolvedValue({ ok: false, response: new Response('no', { status: 403 }) })
    const GET = (await import('./route')).GET
    expect((await callRoute(GET, { params: { id: 'c1' }, searchParams: { namespace: 'demo', pod: 'p1' } })).status).toBe(403)
  })
  it('400 when pod or namespace missing', async () => {
    const GET = (await import('./route')).GET
    expect((await callRoute(GET, { params: { id: 'c1' }, searchParams: { namespace: 'demo' } })).status).toBe(400)
  })
  it('400 when namespace missing', async () => {
    const GET = (await import('./route')).GET
    expect((await callRoute(GET, { params: { id: 'c1' }, searchParams: { pod: 'p1' } })).status).toBe(400)
  })
  it('returns logs and audits success', async () => {
    const GET = (await import('./route')).GET
    const res = await callRoute(GET, { params: { id: 'c1' }, searchParams: { namespace: 'demo', pod: 'p1', container: 'app', previous: '1' } })
    expect(res.status).toBe(200)
    expect(((await readJson(res)) as any).logs).toBe('line')
    expect(logsMock).toHaveBeenCalledWith(expect.objectContaining({ pod: 'p1', container: 'app', previous: true }))
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'logs', category: 'k8s', status: 'success' }))
  })
  it('502 + audit failure when orchestrator unreachable', async () => {
    logsMock.mockResolvedValue({ ok: false, error: 'down' })
    const GET = (await import('./route')).GET
    const res = await callRoute(GET, { params: { id: 'c1' }, searchParams: { namespace: 'demo', pod: 'p1' } })
    expect(res.status).toBe(502)
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'logs', status: 'failure' }))
  })
  it('502 body is fixed error string not orchestrator message', async () => {
    logsMock.mockResolvedValue({ ok: false, error: 'internal detail' })
    const GET = (await import('./route')).GET
    const res = await callRoute(GET, { params: { id: 'c1' }, searchParams: { namespace: 'demo', pod: 'p1' } })
    expect(((await readJson(res)) as any).error).toBe('orchestrator unreachable')
  })
  it('credentialVersion comes from cluster row', async () => {
    const GET = (await import('./route')).GET
    await callRoute(GET, { params: { id: 'c1' }, searchParams: { namespace: 'demo', pod: 'p1' } })
    expect(logsMock).toHaveBeenCalledWith(expect.objectContaining({ credentialVersion: 3 }))
  })
})
