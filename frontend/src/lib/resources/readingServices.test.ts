import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ClusterCapacity, Thresholds } from './capacity'
import type { ReadingRequest } from './readingRoute'

const { overviewMock, targetMock, completeMock } = vi.hoisted(() => ({
  overviewMock: vi.fn(),
  targetMock: vi.fn(),
  completeMock: vi.fn(),
}))

vi.mock('./overviewBuilder', () => ({ getResourcesOverview: (...a: unknown[]) => overviewMock(...a) }))
vi.mock('@/lib/ai/complete', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ai/complete')>('@/lib/ai/complete')

  return {
    ...actual,
    resolveAiTarget: (...a: unknown[]) => targetMock(...a),
    completeText: (...a: unknown[]) => completeMock(...a),
  }
})

import { getForecastInsights } from './forecastInsightsService'
import { getOptimizationPlan } from './optimizationPlanService'

const GiB = 1024 ** 3
const thresholds: Thresholds = { cpu: { warning: 80, critical: 90 }, ram: { warning: 80, critical: 90 }, storage: { warning: 80, critical: 90 } }
const OLLAMA = { provider: 'ollama' as const, model: 'llama3.1:8b', baseUrl: 'http://o' }

const trends = Array.from({ length: 40 }, (_, i) => {
  const d = new Date(Date.UTC(2026, 8, 21 + i)).toISOString().slice(0, 10)

  return { t: d, d, cpu: 10, ram: 40 + i * 0.5, storage: 50 }
})

const cluster: ClusterCapacity = {
  id: 'prod', name: 'PVE-PROD', nodesOnline: 3, nodesTotal: 3,
  cpu: { cores: 48, usedPct: 10, vcpuAllocated: 96, ratio: 2 },
  ram: { total: 192 * GiB, used: 96 * GiB, usedPct: 60, allocated: 120 * GiB, ratio: 0.6 },
  storage: { used: 1, total: 2, pct: 50 },
  guests: { running: 15, stopped: 3, templates: 0 },
  nPlusOne: { applicable: true, largestNode: 'pve1', cpuPctAfter: 15, ramPctAfter: 95, ok: false },
  imbalance: { cpu: 2, ram: 24 },
  trends,
}

const overview = {
  data: {
    kpis: {
      cpu: { used: 10, allocated: 96, total: 48, trend: 0 },
      ram: { used: 60, allocated: 120, total: 192, trend: 0 },
      storage: { used: 50, total: 100, trend: 0 },
      vms: { total: 18, running: 15, stopped: 3 },
      efficiency: 50,
    },
    thresholds,
    trends,
    clusters: [cluster],
    nodes: [],
    storagePools: [],
    connections: [{ id: 'prod', name: 'PVE-PROD' }],
    stoppedAllocation: { count: 3, vcpu: 10, ramBytes: 80 * GiB, diskBytes: 0 },
    largestStopped: [{ id: 'prod:qemu:pve3:200', name: 'old-erp', node: 'pve3', connName: 'PVE-PROD', vcpu: 4, ramBytes: 48 * GiB }],
    overprovisioning: null,
    healthScoreHistory: [],
  },
}

let tenant = 0
const request = (overrides: Partial<ReadingRequest> = {}): ReadingRequest => ({
  prisma: {} as ReadingRequest['prisma'],
  // A tenant per test: the reading caches live at module level.
  tenantId: `tenant-${++tenant}`,
  dateLocale: 'en-US',
  locale: 'en',
  scopeAll: 'all clusters',
  ...overrides,
})

beforeEach(() => {
  overviewMock.mockReset().mockResolvedValue(overview)
  targetMock.mockReset().mockResolvedValue(OLLAMA)
  completeMock.mockReset()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

describe('getForecastInsights', () => {
  it('reads the forecast with the model, figures kept from the digest', async () => {
    completeMock.mockResolvedValue(JSON.stringify({
      summary: 'PVE-PROD does not survive losing pve1.',
      outlook: [{ ref: 'c1', resource: 'ram', risk: 'high', explanation: 'N+1 fails.', action: 'Add RAM.' }],
    }))

    const reading = (await getForecastInsights(request()))!

    expect(reading).toMatchObject({ provider: 'ollama', model: 'llama3.1:8b', summary: 'PVE-PROD does not survive losing pve1.', historyDays: 40 })
    expect(reading.aiFailed).toBeUndefined()
    expect(reading.outlook[0]).toMatchObject({ ref: 'c1', name: 'PVE-PROD', resource: 'ram', risk: 'high' })
    expect(completeMock.mock.calls[0][1]).toMatchObject({ maxTokens: 1500, timeoutMs: 45_000 })
  })

  it('falls back to the rules, flagged, when the model fails or answers nonsense', async () => {
    completeMock.mockRejectedValueOnce(new Error('timeout'))
    await expect(getForecastInsights(request())).resolves.toMatchObject({ provider: 'basic', aiFailed: true })

    completeMock.mockResolvedValueOnce('not json')
    await expect(getForecastInsights(request())).resolves.toMatchObject({ provider: 'basic', aiFailed: true })
  })

  it('uses the rules without a model, not flagged as a failure', async () => {
    targetMock.mockResolvedValue(null)
    const reading = (await getForecastInsights(request()))!

    expect(reading).toMatchObject({ provider: 'basic', aiFailed: false })
    expect(reading.outlook.length).toBeGreaterThan(0)
    expect(completeMock).not.toHaveBeenCalled()
  })

  it('returns null for a connection that is not one of the tenant', async () => {
    await expect(getForecastInsights(request({ filterConnectionId: 'other' }))).resolves.toBeNull()
  })

  it('reuses a reading until a refresh is asked', async () => {
    targetMock.mockResolvedValue(null)
    const req = request()

    await getForecastInsights(req)
    await getForecastInsights(req)
    expect(overviewMock).toHaveBeenCalledTimes(1)

    await getForecastInsights({ ...req, refresh: true })
    expect(overviewMock).toHaveBeenCalledTimes(2)
  })
})

describe('getOptimizationPlan', () => {
  it('ranks the levers with the model', async () => {
    completeMock.mockResolvedValue(JSON.stringify({
      summary: 'Start with the stopped guests.',
      plan: [{ ref: 'l1', priority: 'high', explanation: '80 GB sleep.', action: 'Archive old-erp.' }],
    }))

    const plan = (await getOptimizationPlan(request({ filterConnectionId: 'prod' })))!

    expect(plan).toMatchObject({ provider: 'ollama', model: 'llama3.1:8b', summary: 'Start with the stopped guests.' })
    expect(plan.items[0]).toMatchObject({ kind: 'dormant', priority: 'high', action: 'Archive old-erp.' })
  })

  it('falls back to the rules, flagged, when the model fails', async () => {
    completeMock.mockRejectedValue(new Error('down'))

    await expect(getOptimizationPlan(request())).resolves.toMatchObject({ provider: 'basic', aiFailed: true })
  })

  it('does not call the model when there is nothing to rank', async () => {
    overviewMock.mockResolvedValue({ data: { ...overview.data, clusters: [], stoppedAllocation: null, largestStopped: [] } })
    const plan = (await getOptimizationPlan(request()))!

    expect(plan).toMatchObject({ provider: 'basic', aiFailed: false, items: [] })
    expect(completeMock).not.toHaveBeenCalled()
  })

  it('returns null for a connection that is not one of the tenant', async () => {
    await expect(getOptimizationPlan(request({ filterConnectionId: 'other' }))).resolves.toBeNull()
  })
})
