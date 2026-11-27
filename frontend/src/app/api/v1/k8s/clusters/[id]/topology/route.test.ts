import { describe, it, expect, vi, beforeEach } from 'vitest'
import { callRoute, readJson } from '@/__tests__/setup/route-test'

const gateMock = vi.fn()
const topologyMock = vi.fn()

vi.mock('@/lib/k8s/requireK8sViewCluster', () => ({ requireK8sViewCluster: (...a: any[]) => gateMock(...a) }))
vi.mock('@/lib/k8s/server/topology', () => ({ getClusterTopology: (...a: any[]) => topologyMock(...a) }))

const okGate = {
  ok: true,
  tenantId: 't1',
  cluster: { id: 'c1', credentialVersion: 3 },
  credential: { apiServerUrl: 'https://kube.local', insecureSkipTlsVerify: false, credentialType: 'token', credential: 'tok', contextName: 'default' },
}

const fakeTopologyData = {
  namespaceMode: 'single',
  namespace: 'default',
  groups: [],
  resources: [],
  edges: [],
  infra: { bridgeStatus: 'disabled_no_visibility', hosts: [], k8sNodes: [] },
  meta: {
    truncated: false,
    perKind: {},
    correlation: {
      bridgeStatus: 'disabled_no_visibility',
      attempted: 0, matched: 0, byKey: {}, unmapped: 0, ambiguous: 0, skippedOutOfScope: 0,
      vmScanCapped: false, configFetchFailed: 0,
    },
  },
}

beforeEach(() => {
  gateMock.mockReset().mockResolvedValue(okGate)
  topologyMock.mockReset().mockResolvedValue({ ok: true, value: fakeTopologyData })
})

describe('GET topology route', () => {
  it('returns gate response when gate denies', async () => {
    gateMock.mockResolvedValue({ ok: false, response: new Response('forbidden', { status: 403 }) })
    const { GET } = await import('./route')
    const res = await callRoute(GET, { params: { id: 'c1' } })
    expect(res.status).toBe(403)
  })

  it('200 with topology data on success', async () => {
    const { GET } = await import('./route')
    const res = await callRoute(GET, { params: { id: 'c1' }, searchParams: { namespace: 'default' } })
    expect(res.status).toBe(200)
    const body = await readJson<typeof fakeTopologyData>(res)
    expect(body?.namespaceMode).toBe('single')
    expect(body?.infra.bridgeStatus).toBe('disabled_no_visibility')
  })

  it('502 when getClusterTopology fails', async () => {
    topologyMock.mockResolvedValue({ ok: false, error: 'unreachable' })
    const { GET } = await import('./route')
    const res = await callRoute(GET, { params: { id: 'c1' } })
    expect(res.status).toBe(502)
    const body = await readJson<{ error: string }>(res)
    expect(body?.error).toBe('cluster unreachable')
  })

  it('passes gate.tenantId to getClusterTopology', async () => {
    const { GET } = await import('./route')
    await callRoute(GET, { params: { id: 'c1' }, searchParams: { namespace: 'kube-system' } })
    expect(topologyMock).toHaveBeenCalledWith(expect.objectContaining({
      tenantId: 't1',
      clusterId: 'c1',
      credentialVersion: 3,
      namespace: 'kube-system',
    }))
  })

  it('namespace=all maps to null', async () => {
    const { GET } = await import('./route')
    await callRoute(GET, { params: { id: 'c1' }, searchParams: { namespace: 'all' } })
    expect(topologyMock).toHaveBeenCalledWith(expect.objectContaining({ namespace: null }))
  })

  it('absent namespace maps to null', async () => {
    const { GET } = await import('./route')
    await callRoute(GET, { params: { id: 'c1' } })
    expect(topologyMock).toHaveBeenCalledWith(expect.objectContaining({ namespace: null }))
  })

  it('passes credential from gate to getClusterTopology', async () => {
    const { GET } = await import('./route')
    await callRoute(GET, { params: { id: 'c1' } })
    expect(topologyMock).toHaveBeenCalledWith(expect.objectContaining({
      cred: okGate.credential,
    }))
  })
})
