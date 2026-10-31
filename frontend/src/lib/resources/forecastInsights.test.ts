import { describe, expect, it } from 'vitest'

import type { PredictiveAlert } from '@/app/(dashboard)/infrastructure/resources/types'

import type { ClusterCapacity, StoragePoolCapacity, Thresholds } from './capacity'
import {
  basicForecastReading,
  buildForecastDigest,
  buildForecastPrompt,
  dataConfidence,
  sanitizeForecastReply,
  type ForecastDigest,
} from './forecastInsights'

const GiB = 1024 ** 3
const thresholds: Thresholds = {
  cpu: { warning: 70, critical: 85 },
  ram: { warning: 75, critical: 90 },
  storage: { warning: 80, critical: 90 },
}

function alert(resource: PredictiveAlert['resource'], days: number | null, overrides: Partial<PredictiveAlert> = {}): PredictiveAlert {
  return { resource, currentValue: 50, predictedValue: 60, daysToThreshold: days, threshold: 90, trend: 'up', severity: 'warning', ...overrides }
}

function cluster(overrides: Partial<ClusterCapacity & { alerts: PredictiveAlert[] }> = {}): ClusterCapacity & { alerts: PredictiveAlert[] } {
  return {
    id: 'conn-dr', name: 'PVE-DR', nodesOnline: 3, nodesTotal: 3,
    cpu: { cores: 48, usedPct: 10, vcpuAllocated: 96, ratio: 2 },
    ram: { total: 300 * GiB, used: 200 * GiB, usedPct: 68.2, allocated: 240 * GiB, ratio: 0.8 },
    storage: { used: 46, total: 100, pct: 46 },
    guests: { running: 20, stopped: 4, templates: 1 },
    nPlusOne: { applicable: true, largestNode: 'pve2-dr', cpuPctAfter: 9.2, ramPctAfter: 102, ok: false },
    imbalance: { cpu: 2, ram: 8 },
    trends: Array.from({ length: 30 }, (_, i) => ({ t: `d${i}`, cpu: 10, ram: 50 + i, storage: 46 })),
    alerts: [alert('ram', 52)],
    ...overrides,
  }
}

function pool(overrides: Partial<StoragePoolCapacity> = {}): StoragePoolCapacity {
  return {
    key: 'conn-prod:pve1:zfs', name: 'ZFS-Pool', type: 'zfspool', shared: false, connectionId: 'conn-prod', connectionName: 'PVE-PROD',
    node: 'pve1', used: 93, total: 100, pct: 93.1, growthPctPerDay: 0.2, daysToThreshold: 0,
    ...overrides,
  }
}

function digest(overrides: Partial<Parameters<typeof buildForecastDigest>[0]> = {}): ForecastDigest {
  return buildForecastDigest({
    scope: 'all clusters',
    thresholds,
    windowDays: 90,
    trends: Array.from({ length: 59 }, (_, i) => ({ cpu: 7, ram: 58, storage: 40 + i * 0.05 })),
    kpis: { cpu: { used: 6.7 }, ram: { used: 58 }, storage: { used: 43, total: 100 } },
    alerts: [alert('storage', 188)],
    healthScore: 93,
    healthHistory: [{ score: 100 }, { score: 90 }],
    clusters: [cluster()],
    pools: [pool(), pool({ key: 'p-ok', name: 'quiet', pct: 20, daysToThreshold: null })],
    stopped: { count: 32, vcpu: 77, ramBytes: 42 * GiB, diskBytes: 0 },
    ...overrides,
  })
}

describe('buildForecastDigest', () => {
  it('numbers clusters and only the pools at risk, with the figures the page computed', () => {
    const d = digest()

    expect(d.clusters.map(c => c.ref)).toEqual(['c1'])
    expect(d.clusters[0].resources.ram).toMatchObject({ pct: 68.2, days: 52, threshold: 90, slope: 1 })
    expect(d.clusters[0].nPlusOne).toEqual({ ok: false, node: 'pve2-dr', ramAfter: 102, cpuAfter: 9.2 })
    expect(d.pools.map(p => [p.ref, p.name])).toEqual([['p1', 'ZFS-Pool']])
    expect(d.estate.healthDelta30d).toBe(-10)
    expect(d.dormant).toEqual({ count: 32, vcpu: 77, ramGiB: 42 })
  })

  it('reports no slope under a week of history and no N+1 on a single node', () => {
    const d = digest({ clusters: [cluster({ trends: [], nPlusOne: { applicable: false, largestNode: null, cpuPctAfter: null, ramPctAfter: null, ok: null } })] })

    expect(d.clusters[0].resources.cpu.slope).toBeNull()
    expect(d.clusters[0].nPlusOne).toBeNull()
  })
})

describe('buildForecastPrompt', () => {
  it('carries every ref, the failing N+1 and the language line', () => {
    const prompt = buildForecastPrompt(digest(), 'LANGUAGE: French')

    expect(prompt).toContain('[estate]')
    expect(prompt).toContain('[c1] cluster "PVE-DR"')
    expect(prompt).toContain('N+1: FAILS if pve2-dr is lost (remaining nodes at 102% RAM')
    expect(prompt).toContain('[p1] pool "ZFS-Pool" on node pve1 of PVE-PROD: 93.1% used')
    expect(prompt).toContain('critical threshold reached in 52 days')
    expect(prompt).toContain('critical threshold 90% already crossed')
    expect(prompt).not.toMatch(/\[c1\][^[]*STORAGE/)
    expect(prompt.trim().endsWith('LANGUAGE: French')).toBe(true)
  })
})

describe('sanitizeForecastReply', () => {
  it('keeps entries that point at the digest and takes every figure from it', () => {
    const reading = sanitizeForecastReply({
      summary: 'Le cluster PVE-DR ne tient pas la perte de pve2-dr.',
      outlook: [
        { ref: 'c1', resource: 'ram', risk: 'medium', explanation: 'N+1 en échec et RAM en hausse.', action: 'Ajouter de la RAM.' },
        { ref: 'c9', resource: 'ram', risk: 'high', explanation: 'inventé', action: 'x' },
        { ref: 'p1', resource: 'cpu', risk: 'high', explanation: 'un pool na pas de CPU', action: 'x' },
        { ref: 'c1', resource: 'disk', risk: 'high', explanation: 'ressource inconnue', action: 'x' },
        { ref: 'c1', resource: 'storage', risk: 'high', explanation: 'le stockage se lit par pool', action: 'x' },
      ],
    }, digest())!

    expect(reading.summary).toContain('PVE-DR')
    const c1 = reading.outlook.find(o => o.ref === 'c1')!
    expect(c1).toMatchObject({ name: 'PVE-DR', resource: 'ram', pct: 68.2, days: 52 })
    expect(reading.outlook.some(o => o.ref === 'c9' || o.resource === 'cpu')).toBe(false)
    expect(reading.outlook.some(o => o.ref === 'c1' && o.resource === 'storage')).toBe(false)
  })

  it('never lets the model rate a crossed threshold below high, and drops its "nothing to do" entries', () => {
    const reading = sanitizeForecastReply({
      summary: 's',
      outlook: [
        { ref: 'p1', resource: 'storage', risk: 'low', explanation: 'déjà plein', action: 'nettoyer' },
        { ref: 'estate', resource: 'cpu', risk: 'low', explanation: 'stable', action: 'rien' },
        { ref: 'estate', resource: 'ram', risk: 'medium', explanation: 'surveiller', action: 'surveiller' },
      ],
    }, digest())!

    expect(reading.outlook.find(o => o.ref === 'p1')).toMatchObject({ risk: 'high', explanation: '', explanationKey: 'explainPoolFull', actionKey: 'actionPool' })
    expect(reading.outlook.some(o => o.ref === 'estate')).toBe(false)
  })

  it('adds the failing N+1 the model left out, first', () => {
    const reading = sanitizeForecastReply({
      summary: 's',
      outlook: [{ ref: 'c1', resource: 'ram', risk: 'high', explanation: 'La RAM monte.', action: 'Ajouter de la RAM.' }],
    }, digest())!

    expect(reading.outlook[0]).toMatchObject({ ref: 'c1', explanationKey: 'explainNPlusOne', params: { node: 'pve2-dr', ram: 102 } })
  })

  it('does not add the N+1 again when the model already talks about it', () => {
    const reading = sanitizeForecastReply({
      summary: 's',
      outlook: [{ ref: 'c1', resource: 'ram', risk: 'high', explanation: 'Le N+1 échoue.', action: 'Ajouter un nœud.' }],
    }, digest())!

    expect(reading.outlook.filter(o => o.explanationKey === 'explainNPlusOne')).toHaveLength(0)
  })

  it('gives up on a reply with nothing usable', () => {
    expect(sanitizeForecastReply(null, digest())).toBeNull()
    expect(sanitizeForecastReply('text', digest())).toBeNull()
    expect(sanitizeForecastReply({ summary: '', outlook: [{ ref: 'zz', resource: 'ram', risk: 'high', explanation: 'x' }] }, digest())).toBeNull()
  })
})

describe('basicForecastReading', () => {
  it('lists the failing N+1 first, then the soonest risks, with a summary key', () => {
    const reading = basicForecastReading(digest())

    expect(reading.outlook[0]).toMatchObject({ ref: 'c1', explanationKey: 'explainNPlusOne', risk: 'high' })
    expect(reading.outlook.find(o => o.ref === 'p1')).toMatchObject({ explanationKey: 'explainPoolFull', actionKey: 'actionPool', risk: 'high' })
    expect(reading.summaryKey).toBe('summaryUrgent')
    expect(reading.summaryParams).toMatchObject({ first: 'PVE-DR' })
  })

  it('gives no RAM figure for a failing N+1 when the remaining nodes have no capacity', () => {
    const empty = cluster({ nPlusOne: { applicable: true, largestNode: 'pve2-dr', cpuPctAfter: null, ramPctAfter: null, ok: false } })
    const d = digest({ clusters: [empty] })

    expect(basicForecastReading(d).outlook[0]).toMatchObject({ ref: 'c1', explanationKey: 'explainNPlusOneEmpty', risk: 'high' })
    expect(buildForecastPrompt(d, 'LANGUAGE: English')).toContain('no capacity left on the remaining nodes')
    expect(buildForecastPrompt(d, 'LANGUAGE: English')).not.toContain('null%')
  })

  it('says so when nothing is at risk', () => {
    const quiet = digest({
      clusters: [cluster({ alerts: [alert('ram', null)], nPlusOne: { applicable: true, largestNode: 'a', cpuPctAfter: 10, ramPctAfter: 60, ok: true } })],
      pools: [],
    })

    expect(basicForecastReading(quiet)).toMatchObject({ summaryKey: 'summaryClear', outlook: [] })
  })

  it('reads a runway as medium past a month and low past a quarter', () => {
    const d = digest({ clusters: [cluster({ alerts: [alert('cpu', 60), alert('storage', 200)], nPlusOne: { applicable: false, largestNode: null, cpuPctAfter: null, ramPctAfter: null, ok: null } })], pools: [] })
    const risks = Object.fromEntries(basicForecastReading(d).outlook.map(o => [o.resource, o.risk]))

    expect(risks).toEqual({ cpu: 'medium', storage: 'low' })
  })
})

describe('dataConfidence', () => {
  it('follows the length of the history', () => {
    expect([dataConfidence(10), dataConfidence(59), dataConfidence(120)]).toEqual(['low', 'medium', 'high'])
  })
})
