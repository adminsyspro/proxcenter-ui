import { describe, it, expect, vi, beforeEach } from 'vitest'
import { callRoute, readJson } from '@/__tests__/setup/route-test'

const gateMock = vi.fn()
const listMock = vi.fn()
const getMock = vi.fn()
vi.mock('@/lib/k8s/requireK8sViewCluster', () => ({ requireK8sViewCluster: (...a: any[]) => gateMock(...a) }))
vi.mock('@/lib/k8s/orchestrator', () => ({ listResources: (...a: any[]) => listMock(...a), getResource: (...a: any[]) => getMock(...a) }))

const okGate = { ok: true, tenantId: 't1', cluster: { id: 'c1', credentialVersion: 3 }, credential: {} }

beforeEach(() => {
  gateMock.mockReset().mockResolvedValue(okGate)
  listMock.mockReset().mockResolvedValue({ ok: true, value: { items: [{ kind: 'pod', name: 'p1' }], truncated: false } })
  getMock.mockReset().mockResolvedValue({ ok: true, value: { detail: { ref: { kind: 'pod', name: 'p1' } } } })
})

describe('GET resources', () => {
  it('403 when gate denies', async () => {
    gateMock.mockResolvedValue({ ok: false, response: new Response('no', { status: 403 }) })
    const GET = (await import('./route')).GET
    const res = await callRoute(GET, { params: { id: 'c1' }, searchParams: { kind: 'pod' } })
    expect(res.status).toBe(403)
  })
  it('400 when kind missing or not allowlisted', async () => {
    const GET = (await import('./route')).GET
    expect((await callRoute(GET, { params: { id: 'c1' } })).status).toBe(400)
    expect((await callRoute(GET, { params: { id: 'c1' }, searchParams: { kind: 'secret' } })).status).toBe(400)
  })
  it('400 when namespaced kind detail lacks namespace', async () => {
    const GET = (await import('./route')).GET
    const res = await callRoute(GET, { params: { id: 'c1' }, searchParams: { kind: 'pod', name: 'p1' } })
    expect(res.status).toBe(400)
  })
  it('lists', async () => {
    const GET = (await import('./route')).GET
    const res = await callRoute(GET, { params: { id: 'c1' }, searchParams: { kind: 'pod', namespace: 'demo' } })
    expect(res.status).toBe(200)
    expect(((await readJson(res)) as any).items[0].name).toBe('p1')
    expect(listMock).toHaveBeenCalledWith(expect.objectContaining({ clusterId: 'c1', credentialVersion: 3, kind: 'pod', namespace: 'demo' }))
  })
  it('gets detail when name present', async () => {
    const GET = (await import('./route')).GET
    const res = await callRoute(GET, { params: { id: 'c1' }, searchParams: { kind: 'pod', namespace: 'demo', name: 'p1' } })
    expect(res.status).toBe(200)
    expect(((await readJson(res)) as any).detail.ref.name).toBe('p1')
    expect(getMock).toHaveBeenCalledWith(expect.objectContaining({ clusterId: 'c1', credentialVersion: 3, kind: 'pod', namespace: 'demo', name: 'p1' }))
  })
  it('502 when orchestrator unreachable (ok:false)', async () => {
    listMock.mockResolvedValue({ ok: false, error: 'down' })
    const GET = (await import('./route')).GET
    const res = await callRoute(GET, { params: { id: 'c1' }, searchParams: { kind: 'pod' } })
    expect(res.status).toBe(502)
  })
})
