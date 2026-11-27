import { describe, it, expect, vi, beforeEach } from 'vitest'
import { callRoute, readJson } from '@/__tests__/setup/route-test'

const gateMock = vi.fn()
const eventsMock = vi.fn()
vi.mock('@/lib/k8s/requireK8sViewCluster', () => ({ requireK8sViewCluster: (...a: any[]) => gateMock(...a) }))
vi.mock('@/lib/k8s/orchestrator', () => ({ listEvents: (...a: any[]) => eventsMock(...a) }))

const okGate = { ok: true, tenantId: 't1', cluster: { id: 'c1', credentialVersion: 7 }, credential: {} }

beforeEach(() => {
  gateMock.mockReset().mockResolvedValue(okGate)
  eventsMock.mockReset().mockResolvedValue({ ok: true, value: { items: [{ reason: 'Pulled' }] } })
})

describe('GET events', () => {
  it('403 when gate denies', async () => {
    gateMock.mockResolvedValue({ ok: false, response: new Response('no', { status: 403 }) })
    const GET = (await import('./route')).GET
    expect((await callRoute(GET, { params: { id: 'c1' } })).status).toBe(403)
  })
  it('forwards uid + namespace and returns items', async () => {
    const GET = (await import('./route')).GET
    const res = await callRoute(GET, { params: { id: 'c1' }, searchParams: { namespace: 'demo', uid: 'u9' } })
    expect(res.status).toBe(200)
    expect(((await readJson(res)) as any).items[0].reason).toBe('Pulled')
    expect(eventsMock).toHaveBeenCalledWith(
      expect.objectContaining({ clusterId: 'c1', credentialVersion: 7, namespace: 'demo', involvedUid: 'u9' }),
    )
  })
  it('forwards name param as involvedName', async () => {
    const GET = (await import('./route')).GET
    await callRoute(GET, { params: { id: 'c1' }, searchParams: { name: 'my-pod' } })
    expect(eventsMock).toHaveBeenCalledWith(expect.objectContaining({ involvedName: 'my-pod' }))
  })
  it('credentialVersion comes from cluster row not credential', async () => {
    const GET = (await import('./route')).GET
    await callRoute(GET, { params: { id: 'c1' } })
    expect(eventsMock).toHaveBeenCalledWith(expect.objectContaining({ credentialVersion: 7 }))
  })
  it('502 when orchestrator unreachable', async () => {
    eventsMock.mockResolvedValue({ ok: false, error: 'down' })
    const GET = (await import('./route')).GET
    expect((await callRoute(GET, { params: { id: 'c1' } })).status).toBe(502)
  })
})
