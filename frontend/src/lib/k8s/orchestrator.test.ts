import { describe, it, expect, vi, beforeEach } from 'vitest'

const getClusterHealthMock = vi.fn()
const invalidateClusterClientsMock = vi.fn()
const listResourcesMock = vi.fn()
const getResourceDetailMock = vi.fn()
const listEventsMock = vi.fn()
const getPodLogsMock = vi.fn()
const getNodeMetricsMock = vi.fn()

vi.mock('./server/health', () => ({ getClusterHealth: (...a: any[]) => getClusterHealthMock(...a) }))
vi.mock('./server/client', () => ({
  invalidateClusterClients: (...a: any[]) => invalidateClusterClientsMock(...a),
  buildKubeClient: vi.fn(),
}))
vi.mock('./server/resources', () => ({ listResources: (...a: any[]) => listResourcesMock(...a) }))
vi.mock('./server/getResource', () => ({ getResourceDetail: (...a: any[]) => getResourceDetailMock(...a) }))
vi.mock('./server/events', () => ({ listEvents: (...a: any[]) => listEventsMock(...a) }))
vi.mock('./server/logs', () => ({ getPodLogs: (...a: any[]) => getPodLogsMock(...a) }))
vi.mock('./server/metrics', () => ({ getNodeMetrics: (...a: any[]) => getNodeMetricsMock(...a) }))

import {
  checkConnectivity, fetchHealth, invalidateClient,
  listResources, getResource, listEvents, fetchPodLogs, fetchNodeMetrics,
} from './orchestrator'

const cred = {
  apiServerUrl: 'https://10.0.0.1:6443', insecureSkipTlsVerify: false,
  credentialType: 'token' as const, credential: 't', contextName: 'ctx',
}

beforeEach(() => {
  getClusterHealthMock.mockReset()
  invalidateClusterClientsMock.mockReset()
  listResourcesMock.mockReset()
  getResourceDetailMock.mockReset()
  listEventsMock.mockReset()
  getPodLogsMock.mockReset()
  getNodeMetricsMock.mockReset()
})

// ── health / connectivity (local TS client) ────────────────────────────────

describe('orchestrator wrapper (health via local TS client)', () => {
  it('checkConnectivity delegates to getClusterHealth and returns health on success', async () => {
    getClusterHealthMock.mockResolvedValue({ ok: true, value: { state: 'healthy', version: 'v1.30.0', nodesReady: 3, nodesTotal: 3 } })
    const r = await checkConnectivity(cred)
    expect(r.ok).toBe(true)
    expect(r.value?.state).toBe('healthy')
    expect(getClusterHealthMock).toHaveBeenCalledWith(expect.objectContaining({
      server: 'https://10.0.0.1:6443',
      cred: { type: 'token', value: 't' },
      skipCache: true,
    }))
  })

  it('checkConnectivity returns ok:false when getClusterHealth fails', async () => {
    getClusterHealthMock.mockResolvedValue({ ok: false, errorCode: 'unreachable', value: { state: 'unreachable' } })
    const r = await checkConnectivity(cred)
    expect(r.ok).toBe(false)
    expect(r.error).toBe('unreachable')
  })

  it('fetchHealth includes clusterId + credentialVersion in the getClusterHealth call', async () => {
    getClusterHealthMock.mockResolvedValue({ ok: true, value: { state: 'degraded', nodesReady: 1, nodesTotal: 2 } })
    await fetchHealth({ clusterId: 'c1', credentialVersion: 2, cred })
    const [input] = getClusterHealthMock.mock.calls[0]
    expect(input.clusterId).toBe('c1')
    expect(input.credentialVersion).toBe(2)
  })

  it('invalidateClient calls invalidateClusterClients and resolves', async () => {
    await expect(invalidateClient('c1')).resolves.toBeUndefined()
    expect(invalidateClusterClientsMock).toHaveBeenCalledWith('c1')
  })

  it('invalidateClient completes even when sync function is a no-op', async () => {
    await expect(invalidateClient('c2')).resolves.toBeUndefined()
  })
})

// ── listResources ──────────────────────────────────────────────────────────

describe('listResources (local TS client)', () => {
  it('returns ok + value on success', async () => {
    const value = { items: [{ kind: 'pod', name: 'p1' }], truncated: false }
    listResourcesMock.mockResolvedValue({ ok: true, value })
    const r = await listResources({ clusterId: 'c1', credentialVersion: 1, cred, kind: 'pod', namespace: 'demo' })
    expect(r.ok).toBe(true)
    expect(r.value).toEqual(value)
    expect(listResourcesMock).toHaveBeenCalledWith(
      expect.objectContaining({ clusterId: 'c1', server: cred.apiServerUrl }),
      'pod',
      'demo',
    )
  })

  it('returns ok:false with errorCode on failure', async () => {
    listResourcesMock.mockResolvedValue({ ok: false, errorCode: 'forbidden' })
    const r = await listResources({ clusterId: 'c1', credentialVersion: 1, cred, kind: 'pod' })
    expect(r.ok).toBe(false)
    expect(r.error).toBe('forbidden')
  })
})

// ── getResource ────────────────────────────────────────────────────────────

describe('getResource (local TS client)', () => {
  it('returns ok + wrapped detail on success', async () => {
    const detail = { ref: { kind: 'pod', name: 'p1' }, yaml: '', labels: {}, annotations: {}, summary: {}, createdAt: '' }
    getResourceDetailMock.mockResolvedValue({ ok: true, value: detail })
    const r = await getResource({ clusterId: 'c1', credentialVersion: 1, cred, kind: 'pod', namespace: 'demo', name: 'p1' })
    expect(r.ok).toBe(true)
    expect(r.value?.detail).toEqual(detail)
    expect(getResourceDetailMock).toHaveBeenCalledWith(
      expect.objectContaining({ clusterId: 'c1', server: cred.apiServerUrl }),
      'pod',
      'demo',
      'p1',
    )
  })

  it('returns ok:false on failure', async () => {
    getResourceDetailMock.mockResolvedValue({ ok: false, errorCode: 'not_found' })
    const r = await getResource({ clusterId: 'c1', credentialVersion: 1, cred, kind: 'pod', namespace: 'demo', name: 'missing' })
    expect(r.ok).toBe(false)
    expect(r.error).toBe('not_found')
  })
})

// ── listEvents ─────────────────────────────────────────────────────────────

describe('listEvents (local TS client)', () => {
  it('returns ok + value on success', async () => {
    const value = { items: [{ reason: 'Pulled', type: 'Normal', message: '', object: '', count: 1, firstSeen: '', lastSeen: '' }] }
    listEventsMock.mockResolvedValue({ ok: true, value })
    const r = await listEvents({ clusterId: 'c1', credentialVersion: 1, cred, namespace: 'demo', involvedUid: 'u9' })
    expect(r.ok).toBe(true)
    expect(r.value).toEqual(value)
    expect(listEventsMock).toHaveBeenCalledWith(
      expect.objectContaining({ clusterId: 'c1', server: cred.apiServerUrl }),
      expect.objectContaining({ namespace: 'demo', involvedUid: 'u9' }),
    )
  })

  it('returns ok:false on failure', async () => {
    listEventsMock.mockResolvedValue({ ok: false, errorCode: 'unreachable' })
    const r = await listEvents({ clusterId: 'c1', credentialVersion: 1, cred })
    expect(r.ok).toBe(false)
  })
})

// ── fetchPodLogs ───────────────────────────────────────────────────────────

describe('fetchPodLogs (local TS client)', () => {
  it('returns ok + logs on success', async () => {
    getPodLogsMock.mockResolvedValue({ ok: true, value: { logs: 'log line 1\n' } })
    const r = await fetchPodLogs({ clusterId: 'c1', credentialVersion: 1, cred, namespace: 'demo', pod: 'p1', container: 'app', tailLines: 100, previous: false })
    expect(r.ok).toBe(true)
    expect(r.value?.logs).toBe('log line 1\n')
    expect(getPodLogsMock).toHaveBeenCalledWith(
      expect.objectContaining({ clusterId: 'c1', server: cred.apiServerUrl }),
      'demo',
      'p1',
      expect.objectContaining({ container: 'app', tailLines: 100, previous: false }),
    )
  })

  it('returns ok:false on failure', async () => {
    getPodLogsMock.mockResolvedValue({ ok: false, errorCode: 'not_found' })
    const r = await fetchPodLogs({ clusterId: 'c1', credentialVersion: 1, cred, namespace: 'demo', pod: 'missing' })
    expect(r.ok).toBe(false)
  })
})

// ── fetchNodeMetrics ───────────────────────────────────────────────────────

describe('fetchNodeMetrics (local TS client)', () => {
  it('returns ok + value on success', async () => {
    const value = { nodes: [], totalNodes: 2, reportingNodes: 2 }
    getNodeMetricsMock.mockResolvedValue({ ok: true, value })
    const r = await fetchNodeMetrics({ clusterId: 'c1', credentialVersion: 1, cred })
    expect(r).toEqual({ ok: true, value })
    expect(getNodeMetricsMock).toHaveBeenCalledWith(expect.objectContaining({ clusterId: 'c1', server: cred.apiServerUrl }))
  })

  it('returns ok:false with errorCode on failure', async () => {
    getNodeMetricsMock.mockResolvedValue({ ok: false, errorCode: 'metrics_unavailable' })
    const r = await fetchNodeMetrics({ clusterId: 'c1', credentialVersion: 1, cred })
    expect(r.ok).toBe(false)
    expect(r.error).toBe('metrics_unavailable')
  })

  it('propagates partial value (totalNodes) when metrics call fails with a value', async () => {
    const value = { nodes: [], totalNodes: 3, reportingNodes: 0, errorCode: 'metrics_unavailable' }
    getNodeMetricsMock.mockResolvedValue({ ok: false, errorCode: 'metrics_unavailable', value })
    const r = await fetchNodeMetrics({ clusterId: 'c1', credentialVersion: 1, cred })
    expect(r.ok).toBe(false)
    expect(r.value?.totalNodes).toBe(3)
  })
})
