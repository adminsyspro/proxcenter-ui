/**
 * TDD tests for metrics.ts:
 *   - Unit: parseCpuMillis / parseMemBytes
 *   - Unit: joinMetrics (join logic, partial reporting, zero/over-allocatable, duplicates)
 *   - Unit: classifyMetricsError (mirrors classifyMetricsError in metrics.go)
 *   - Unit: getNodeMetrics with mocked buildKubeClient (node-list error, metrics error, happy path)
 *   - Integration: real HTTPS fixture server -> getNodeMetrics (metrics + node list endpoints)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

import { parseCpuMillis, parseMemBytes, joinMetrics, classifyMetricsError, podUsagesFromMetricsList, joinPodMetrics } from './metrics'
import type { RawNodeMetric, RawNodeAlloc, NodeAlloc } from './metrics'

// ---------------------------------------------------------------------------
// parseCpuMillis
// ---------------------------------------------------------------------------

describe('parseCpuMillis', () => {
  it('parses millicores suffix', () => { expect(parseCpuMillis('250m')).toBe(250) })
  it('parses whole cores', () => { expect(parseCpuMillis('2')).toBe(2000) })
  it('parses nanocores (n)', () => { expect(parseCpuMillis('500000000n')).toBe(500) })
  it('parses microcores (u)', () => { expect(parseCpuMillis('500000u')).toBe(500) })
  it('returns 0 for empty string', () => { expect(parseCpuMillis('')).toBe(0) })
  it('floors fractional millicores', () => { expect(parseCpuMillis('1500m')).toBe(1500) })
})

// ---------------------------------------------------------------------------
// parseMemBytes
// ---------------------------------------------------------------------------

describe('parseMemBytes', () => {
  it('parses Ki', () => { expect(parseMemBytes('64Ki')).toBe(65536) })
  it('parses Mi', () => { expect(parseMemBytes('512Mi')).toBe(512 * 1024 ** 2) })
  it('parses Gi', () => { expect(parseMemBytes('8Gi')).toBe(8 * 1024 ** 3) })
  it('parses Ti', () => { expect(parseMemBytes('2Ti')).toBe(2 * 1024 ** 4) })
  it('parses k (SI)', () => { expect(parseMemBytes('64k')).toBe(64_000) })
  it('parses M (SI)', () => { expect(parseMemBytes('512M')).toBe(512_000_000) })
  it('parses G (SI)', () => { expect(parseMemBytes('4G')).toBe(4_000_000_000) })
  it('parses bare bytes', () => { expect(parseMemBytes('1073741824')).toBe(1073741824) })
  it('returns 0 for empty string', () => { expect(parseMemBytes('')).toBe(0) })
})

// ---------------------------------------------------------------------------
// classifyMetricsError
// ---------------------------------------------------------------------------

describe('classifyMetricsError', () => {
  it('404 -> metrics_unavailable', () => { expect(classifyMetricsError({ code: 404 })).toBe('metrics_unavailable') })
  it('503 -> metrics_unavailable', () => { expect(classifyMetricsError({ code: 503 })).toBe('metrics_unavailable') })
  it('401 -> auth_failed', () => { expect(classifyMetricsError({ code: 401 })).toBe('auth_failed') })
  it('403 -> forbidden', () => { expect(classifyMetricsError({ code: 403 })).toBe('forbidden') })
  it('network error -> unreachable', () => { expect(classifyMetricsError(new Error('ECONNREFUSED'))).toBe('unreachable') })
  it('statusCode fallback', () => { expect(classifyMetricsError({ statusCode: 404 })).toBe('metrics_unavailable') })
})

// ---------------------------------------------------------------------------
// joinMetrics
// ---------------------------------------------------------------------------

function m(name: string, cpuRaw: string, memRaw: string, timestamp?: string): RawNodeMetric {
  return { name, cpuRaw, memRaw, timestamp }
}
function a(name: string, cpuAllocMilli: number, memAllocBytes: number): RawNodeAlloc {
  return { name, cpuAllocMilli, memAllocBytes }
}

describe('joinMetrics — happy path', () => {
  it('joins metrics with allocatable, sorts by name, sets sampleTime to oldest', () => {
    const result = joinMetrics(
      [
        m('node-b', '500m', '1Gi', '2024-06-01T12:00:00Z'),
        m('node-a', '250m', '512Mi', '2024-06-01T11:00:00Z'),
      ],
      [
        a('node-a', 4000, 8 * 1024 ** 3),
        a('node-b', 4000, 8 * 1024 ** 3),
      ],
    )
    expect(result.nodes.map(n => n.name)).toEqual(['node-a', 'node-b'])
    expect(result.nodes[0].cpuUsedMilli).toBe(250)
    expect(result.nodes[0].cpuAllocMilli).toBe(4000)
    expect(result.nodes[0].memUsedBytes).toBe(512 * 1024 ** 2)
    expect(result.nodes[1].cpuUsedMilli).toBe(500)
    expect(result.totalNodes).toBe(2)
    expect(result.reportingNodes).toBe(2)
    // oldest = 11:00
    expect(result.sampleTime).toBe('2024-06-01T11:00:00Z')
  })

  it('no sampleTime when no timestamps provided', () => {
    const result = joinMetrics([m('node-a', '100m', '1Gi')], [a('node-a', 1000, 1024 ** 3)])
    expect(result.sampleTime).toBeUndefined()
  })
})

describe('joinMetrics — partial reporting', () => {
  it('drops metrics entry with no matching allocatable node', () => {
    const result = joinMetrics(
      [m('phantom', '100m', '1Gi'), m('real', '200m', '2Gi')],
      [a('real', 2000, 4 * 1024 ** 3)],
    )
    expect(result.nodes).toHaveLength(1)
    expect(result.nodes[0].name).toBe('real')
    expect(result.totalNodes).toBe(1)
    expect(result.reportingNodes).toBe(1)
  })

  it('core nodes with no metrics sample count in totalNodes but not reportingNodes', () => {
    const result = joinMetrics(
      [m('node-a', '100m', '1Gi')],
      [a('node-a', 1000, 1024 ** 3), a('node-b', 2000, 2 * 1024 ** 3)],
    )
    expect(result.totalNodes).toBe(2)
    expect(result.reportingNodes).toBe(1)
  })

  it('empty metrics list returns zero reportingNodes', () => {
    const result = joinMetrics([], [a('node-a', 1000, 1024 ** 3)])
    expect(result.reportingNodes).toBe(0)
    expect(result.totalNodes).toBe(1)
    expect(result.nodes).toHaveLength(0)
    expect(result.sampleTime).toBeUndefined()
  })

  it('empty allocs + metrics gives zeros across the board', () => {
    const result = joinMetrics([], [])
    expect(result.reportingNodes).toBe(0)
    expect(result.totalNodes).toBe(0)
  })
})

describe('joinMetrics — zero / non-positive allocatable', () => {
  it('drops node when cpuAllocMilli is 0', () => {
    const result = joinMetrics([m('n', '100m', '1Gi')], [a('n', 0, 1024 ** 3)])
    expect(result.nodes).toHaveLength(0)
    // totalNodes still counts the node (it exists in core list)
    expect(result.totalNodes).toBe(1)
  })

  it('drops node when memAllocBytes is 0', () => {
    const result = joinMetrics([m('n', '100m', '1Gi')], [a('n', 1000, 0)])
    expect(result.nodes).toHaveLength(0)
  })

  it('drops node when cpuAllocMilli is negative', () => {
    const result = joinMetrics([m('n', '100m', '1Gi')], [a('n', -1, 1024 ** 3)])
    expect(result.nodes).toHaveLength(0)
  })
})

describe('joinMetrics — over-allocated usage (usage > allocatable)', () => {
  it('allows usage > allocatable (clamping is the UI layer responsibility)', () => {
    const result = joinMetrics(
      [m('n', '8000m', '32Gi')],
      [a('n', 4000, 8 * 1024 ** 3)],
    )
    expect(result.nodes[0].cpuUsedMilli).toBe(8000)
    expect(result.nodes[0].cpuAllocMilli).toBe(4000)
  })
})

describe('joinMetrics — duplicate metrics entries', () => {
  it('de-dupes: first entry wins, subsequent dropped', () => {
    const result = joinMetrics(
      [
        m('n', '100m', '1Gi', '2024-06-01T10:00:00Z'),
        m('n', '900m', '7Gi', '2024-06-01T09:00:00Z'), // duplicate, should be dropped
      ],
      [a('n', 4000, 8 * 1024 ** 3)],
    )
    expect(result.nodes).toHaveLength(1)
    expect(result.nodes[0].cpuUsedMilli).toBe(100)
    expect(result.reportingNodes).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// getNodeMetrics — unit tests with mocked buildKubeClient
// ---------------------------------------------------------------------------

const buildKubeClientMock = vi.fn()
const classifyK8sErrorMock = vi.fn()
const getNodeMetricsMock = vi.fn()
const getPodMetricsMock = vi.fn()

vi.mock('./client', () => ({
  buildKubeClient: (...a: any[]) => buildKubeClientMock(...a),
  invalidateClusterClients: () => {},
}))

vi.mock('./errors', () => ({
  classifyK8sError: (...a: any[]) => classifyK8sErrorMock(...a),
}))

// Mock @kubernetes/client-node Metrics class — kept active for unit tests.
// Integration tests use vi.importActual to get the real implementation.
vi.mock('@kubernetes/client-node', async (importOriginal) => {
  const actual = await importOriginal() as any
  return {
    ...actual,
    Metrics: class MockMetrics {
      constructor(_kc: any) {}
      getNodeMetrics() { return getNodeMetricsMock() }
      getPodMetrics() { return getPodMetricsMock() }
    },
  }
})

import { getNodeMetrics, getPodMetrics } from './metrics'

function makeBuiltClient(
  nodeListResult: any,
  nodeListThrows?: any,
  podListResult?: any,
) {
  const coreApi = {
    listNode: async () => {
      if (nodeListThrows) throw nodeListThrows
      return nodeListResult
    },
    listPodForAllNamespaces: async () => podListResult,
  }
  // kc only needs to exist — the Metrics constructor is mocked away
  const kc = { _placeholder: true }
  return { ok: true, makeApiClient: () => coreApi, kc, api: coreApi }
}

const baseInput = {
  clusterId: 'c1', credentialVersion: 1,
  server: 'https://k:6443', cred: { type: 'token' as const, value: 't' },
}

const nodeListFixture = {
  items: [
    { metadata: { name: 'node-a' }, status: { allocatable: { cpu: '4', memory: '8Gi' } } },
    { metadata: { name: 'node-b' }, status: { allocatable: { cpu: '4', memory: '8Gi' } } },
  ],
}

const metricsListFixture = {
  items: [
    { metadata: { name: 'node-a' }, timestamp: '2024-06-01T10:00:00Z', usage: { cpu: '1000m', memory: '2Gi' } },
    { metadata: { name: 'node-b' }, timestamp: '2024-06-01T09:00:00Z', usage: { cpu: '2000m', memory: '4Gi' } },
  ],
}

beforeEach(() => {
  buildKubeClientMock.mockReset()
  classifyK8sErrorMock.mockReset().mockReturnValue('unreachable')
  getNodeMetricsMock.mockReset()
  getPodMetricsMock.mockReset()
})

describe('getNodeMetrics — buildKubeClient failure', () => {
  it('returns ok:false with errorCode config when client build fails', async () => {
    buildKubeClientMock.mockReturnValueOnce({ ok: false, error: 'bad url' })
    const r = await getNodeMetrics(baseInput)
    expect(r.ok).toBe(false)
    expect(r.errorCode).toBe('config')
  })
})

describe('getNodeMetrics — node list error', () => {
  it('returns ok:false with classified error when listNode throws', async () => {
    const err: any = new Error('Forbidden')
    err.code = 403
    buildKubeClientMock.mockReturnValueOnce(makeBuiltClient(null, err))
    classifyK8sErrorMock.mockReturnValueOnce('forbidden')
    const r = await getNodeMetrics(baseInput)
    expect(r.ok).toBe(false)
    expect(r.errorCode).toBe('forbidden')
    expect(r.value?.errorMessage).toBe('node list failed')
  })
})

describe('getNodeMetrics — metrics_unavailable', () => {
  it('returns ok:false errorCode metrics_unavailable when metrics API missing', async () => {
    buildKubeClientMock.mockReturnValueOnce(makeBuiltClient(nodeListFixture))
    const err: any = new Error('Not Found')
    err.code = 404
    getNodeMetricsMock.mockRejectedValueOnce(err)
    const r = await getNodeMetrics(baseInput)
    expect(r.ok).toBe(false)
    expect(r.errorCode).toBe('metrics_unavailable')
    // Still includes totalNodes from the node list
    expect(r.value?.totalNodes).toBe(2)
    expect(r.value?.reportingNodes).toBe(0)
    expect(r.value?.errorMessage).toBe('metrics list failed')
  })
})

describe('getNodeMetrics — happy path', () => {
  it('joins node list + metrics, sorts by name, computes sampleTime (oldest)', async () => {
    buildKubeClientMock.mockReturnValueOnce(makeBuiltClient(nodeListFixture))
    getNodeMetricsMock.mockResolvedValueOnce(metricsListFixture)

    const r = await getNodeMetrics(baseInput)
    expect(r.ok).toBe(true)
    expect(r.value?.totalNodes).toBe(2)
    expect(r.value?.reportingNodes).toBe(2)
    expect(r.value?.nodes.map(n => n.name)).toEqual(['node-a', 'node-b'])
    expect(r.value?.nodes[0].cpuUsedMilli).toBe(1000)
    expect(r.value?.nodes[0].cpuAllocMilli).toBe(4000)
    expect(r.value?.nodes[0].memUsedBytes).toBe(2 * 1024 ** 3)
    expect(r.value?.nodes[1].cpuUsedMilli).toBe(2000)
    // oldest = node-b at 09:00
    expect(r.value?.sampleTime).toBe('2024-06-01T09:00:00Z')
  })

  it('partial: one node has metrics, other does not', async () => {
    const partialMetrics = { items: [metricsListFixture.items[0]] }
    buildKubeClientMock.mockReturnValueOnce(makeBuiltClient(nodeListFixture))
    getNodeMetricsMock.mockResolvedValueOnce(partialMetrics)

    const r = await getNodeMetrics(baseInput)
    expect(r.ok).toBe(true)
    expect(r.value?.totalNodes).toBe(2)
    expect(r.value?.reportingNodes).toBe(1)
    expect(r.value?.nodes).toHaveLength(1)
    expect(r.value?.nodes[0].name).toBe('node-a')
  })
})

// ---------------------------------------------------------------------------
// podUsagesFromMetricsList
// ---------------------------------------------------------------------------

describe('podUsagesFromMetricsList', () => {
  it('sums per-container CPU/memory usage per pod', () => {
    const items = [
      {
        metadata: { namespace: 'default', name: 'web' },
        containers: [
          { name: 'app', usage: { cpu: '250m', memory: '256Mi' } },
          { name: 'sidecar', usage: { cpu: '150m', memory: '256Mi' } },
        ],
      },
    ]
    expect(podUsagesFromMetricsList(items)).toEqual([
      { namespace: 'default', name: 'web', cpuUsedMilli: 400, memUsedBytes: 512 * 1024 ** 2 },
    ])
  })

  it('skips items without a name and tolerates missing containers/usage', () => {
    const items = [
      { metadata: { namespace: 'x' }, containers: [{ usage: { cpu: '100m' } }] }, // no name → skipped
      { metadata: { namespace: 'ns', name: 'p2' } },                               // no containers → 0/0
    ]
    expect(podUsagesFromMetricsList(items)).toEqual([
      { namespace: 'ns', name: 'p2', cpuUsedMilli: 0, memUsedBytes: 0 },
    ])
  })

  it('returns empty for null/undefined input', () => {
    expect(podUsagesFromMetricsList(undefined as any)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// joinPodMetrics
// ---------------------------------------------------------------------------

describe('joinPodMetrics', () => {
  const nodeAlloc = new Map<string, NodeAlloc>([
    ['node-a', { cpuAllocMilli: 4000, memAllocBytes: 8 * 1024 ** 3 }],
  ])

  it('computes % of the pod node capacity and sorts by ns/name', () => {
    const usages = [
      { namespace: 'default', name: 'web', cpuUsedMilli: 1000, memUsedBytes: 2 * 1024 ** 3 },
      { namespace: 'default', name: 'api', cpuUsedMilli: 2000, memUsedBytes: 4 * 1024 ** 3 },
    ]
    const podNode = new Map([['default/web', 'node-a'], ['default/api', 'node-a']])
    expect(joinPodMetrics(usages, podNode, nodeAlloc)).toEqual([
      { namespace: 'default', name: 'api', cpuPct: 50, memPct: 50 },
      { namespace: 'default', name: 'web', cpuPct: 25, memPct: 25 },
    ])
  })

  it('drops pods whose node is unknown or lacks positive allocatable', () => {
    const usages = [
      { namespace: 'default', name: 'orphan', cpuUsedMilli: 500, memUsedBytes: 1024 },   // node not in podNode
      { namespace: 'default', name: 'nonode', cpuUsedMilli: 500, memUsedBytes: 1024 },   // node has no alloc
    ]
    const podNode = new Map([['default/nonode', 'node-z']])
    const alloc = new Map<string, NodeAlloc>([['node-z', { cpuAllocMilli: 0, memAllocBytes: 0 }]])
    expect(joinPodMetrics(usages, podNode, alloc)).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// getPodMetrics (mocked buildKubeClient + Metrics.getPodMetrics)
// ---------------------------------------------------------------------------

describe('getPodMetrics', () => {
  const podListFixture = {
    items: [
      { metadata: { namespace: 'default', name: 'web' }, spec: { nodeName: 'node-a' } },
      { metadata: { namespace: 'default', name: 'pending' }, spec: {} }, // unscheduled → dropped
    ],
  }
  const podMetricsFixture = {
    items: [
      { metadata: { namespace: 'default', name: 'web' }, containers: [{ usage: { cpu: '1000m', memory: '2Gi' } }] },
      { metadata: { namespace: 'default', name: 'pending' }, containers: [{ usage: { cpu: '10m', memory: '10Mi' } }] },
    ],
  }

  it('joins pod usage with the pod node allocatable → % (drops unscheduled)', async () => {
    buildKubeClientMock.mockReturnValueOnce(makeBuiltClient(nodeListFixture, undefined, podListFixture))
    getPodMetricsMock.mockResolvedValueOnce(podMetricsFixture)
    const r = await getPodMetrics(baseInput)
    expect(r.ok).toBe(true)
    // node-a alloc = 4000m / 8Gi → web uses 1000m/2Gi = 25% / 25%
    expect(r.value?.pods).toEqual([{ namespace: 'default', name: 'web', cpuPct: 25, memPct: 25 }])
  })

  it('returns ok:false errorCode config when client build fails', async () => {
    buildKubeClientMock.mockReturnValueOnce({ ok: false, error: 'bad url' })
    const r = await getPodMetrics(baseInput)
    expect(r.ok).toBe(false)
    expect(r.errorCode).toBe('config')
  })

  it('maps a missing metrics-server (404) to metrics_unavailable', async () => {
    buildKubeClientMock.mockReturnValueOnce(makeBuiltClient(nodeListFixture, undefined, podListFixture))
    const err: any = new Error('Not Found')
    err.code = 404
    getPodMetricsMock.mockRejectedValueOnce(err)
    const r = await getPodMetrics(baseInput)
    expect(r.ok).toBe(false)
    expect(r.errorCode).toBe('metrics_unavailable')
  })
})

// Integration tests live in metrics.integration.test.ts (separate file,
// no module mocks) — see that file for real HTTPS fixture server tests.
