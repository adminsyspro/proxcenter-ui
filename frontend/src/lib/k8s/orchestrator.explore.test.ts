import { describe, it, expect, vi, beforeEach } from 'vitest'

const listResourcesMock = vi.fn()
const getResourceDetailMock = vi.fn()
const listEventsMock = vi.fn()
const getPodLogsMock = vi.fn()

vi.mock('./server/health', () => ({ getClusterHealth: vi.fn() }))
vi.mock('./server/client', () => ({ invalidateClusterClients: vi.fn(), buildKubeClient: vi.fn() }))
vi.mock('./server/resources', () => ({ listResources: (...a: any[]) => listResourcesMock(...a) }))
vi.mock('./server/getResource', () => ({ getResourceDetail: (...a: any[]) => getResourceDetailMock(...a) }))
vi.mock('./server/events', () => ({ listEvents: (...a: any[]) => listEventsMock(...a) }))
vi.mock('./server/logs', () => ({ getPodLogs: (...a: any[]) => getPodLogsMock(...a) }))
vi.mock('./server/metrics', () => ({ getNodeMetrics: vi.fn() }))

import { listResources, getResource, listEvents, fetchPodLogs } from './orchestrator'

const cred = { apiServerUrl: 'https://10.0.0.1:6443', caDataPem: 'CA', tlsServerName: '', insecureSkipTlsVerify: false, credentialType: 'token' as const, credential: 'tok', contextName: 'ctx' }
const base = { clusterId: 'c1', credentialVersion: 2, cred }

beforeEach(() => {
  listResourcesMock.mockReset()
  getResourceDetailMock.mockReset()
  listEventsMock.mockReset()
  getPodLogsMock.mockReset()
})

describe('explore orchestrator wrappers (local TS client)', () => {
  it('listResources forwards kind/namespace to local service', async () => {
    listResourcesMock.mockResolvedValue({ ok: true, value: { items: [], truncated: false } })
    const r = await listResources({ ...base, kind: 'pod', namespace: 'demo' })
    expect(r.ok).toBe(true)
    expect(r.value).toEqual({ items: [], truncated: false })
    expect(listResourcesMock).toHaveBeenCalledWith(
      expect.objectContaining({ clusterId: 'c1', credentialVersion: 2, server: 'https://10.0.0.1:6443', cred: { type: 'token', value: 'tok' } }),
      'pod',
      'demo',
    )
  })

  it('getResource forwards kind/namespace/name to getResourceDetail and wraps in detail', async () => {
    const detail = { ref: { kind: 'pod', name: 'p1', uid: '', namespace: 'demo' }, yaml: '', labels: {}, annotations: {}, summary: {}, createdAt: '' }
    getResourceDetailMock.mockResolvedValue({ ok: true, value: detail })
    const r = await getResource({ ...base, kind: 'pod', namespace: 'demo', name: 'p1' })
    expect(r.ok).toBe(true)
    expect(r.value?.detail).toEqual(detail)
    expect(getResourceDetailMock).toHaveBeenCalledWith(
      expect.objectContaining({ clusterId: 'c1', server: 'https://10.0.0.1:6443' }),
      'pod',
      'demo',
      'p1',
    )
  })

  it('fetchPodLogs forwards container/tailLines/previous to getPodLogs', async () => {
    getPodLogsMock.mockResolvedValue({ ok: true, value: { logs: 'hi' } })
    const r = await fetchPodLogs({ ...base, namespace: 'demo', pod: 'p1', container: 'app', tailLines: 50, previous: true })
    expect(r.ok).toBe(true)
    expect(r.value?.logs).toBe('hi')
    expect(getPodLogsMock).toHaveBeenCalledWith(
      expect.objectContaining({ clusterId: 'c1', server: 'https://10.0.0.1:6443' }),
      'demo',
      'p1',
      expect.objectContaining({ container: 'app', tailLines: 50, previous: true }),
    )
  })

  it('listEvents returns ok:false when local service fails', async () => {
    listEventsMock.mockResolvedValue({ ok: false, errorCode: 'unreachable' })
    const r = await listEvents({ ...base, namespace: 'demo' })
    expect(r.ok).toBe(false)
    expect(r.error).toBe('unreachable')
    expect(r.value).toBeUndefined()
  })
})
