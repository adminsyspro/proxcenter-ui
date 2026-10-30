import { describe, it, expect } from 'vitest'

import {
  CHART_SERIES,
  chartFromToolResult,
  collectCharts,
  MAX_CHART_ROWS,
  MAX_CHARTS,
  MAX_HISTORY_POINTS,
  sanitizeChart,
  type AiChart,
} from './charts'

// Shapes returned by the catalog tools on the lab (30/10/2026).
const HOSTS = {
  total: 3,
  hosts: [
    { name: 'pve1', cluster: 'PVE-PROD', cpuPct: 3.14, memoryPct: 22.3 },
    { name: 'pve2', cluster: 'PVE-PROD', cpuPct: 3.3, memoryPct: 80.66 },
    { name: 'pve3', cluster: 'PVE-PROD', cpuPct: null, memoryPct: 37.6 },
  ],
}

const RAM_RANKING = {
  metric: 'memory_usage',
  unit: '%',
  ranking: [
    { rank: 1, name: 's117e-1', node: 'pve1-dr', cluster: 'PVE-DR', memoryUsagePct: 93.4, vcpus: 2 },
    { rank: 2, name: 'harbor-234', node: 'pve2', cluster: 'PVE-PROD', memoryUsagePct: 91.9, vcpus: 4 },
  ],
}

const STORAGE = {
  metric: 'used_pct',
  unit: 'GB',
  ranking: [
    { rank: 1, name: 'ZFS-Pool', cluster: 'PVE-PROD', host: 'pve1', shared: false, usedPct: 93.1 },
    { rank: 2, name: 'CephStoragePool', cluster: 'PVE-PROD', host: null, shared: true, usedPct: 86.8 },
    { rank: 3, name: 'ZFS-Pool', cluster: 'PVE-PROD', host: 'pve3', shared: false, usedPct: 69.7 },
  ],
}

describe('chartFromToolResult', () => {
  it('plots CPU and RAM per host, skipping a host with a missing reading', () => {
    expect(chartFromToolResult('list_hosts', HOSTS)).toEqual({
      kind: 'host-usage',
      unit: '%',
      series: ['cpu', 'memory'],
      rows: [
        { label: 'pve1', detail: 'PVE-PROD', values: [3.1, 22.3] },
        { label: 'pve2', detail: 'PVE-PROD', values: [3.3, 80.7] },
      ],
    })
  })

  it('plots the ranked metric of a guest ranking, whatever the metric', () => {
    expect(chartFromToolResult('rank_guest_hardware', RAM_RANKING)).toEqual({
      kind: 'guest-ranking',
      metric: 'memory_usage',
      unit: '%',
      series: ['memory_usage'],
      rows: [
        { label: 's117e-1', detail: 'pve1-dr · PVE-DR', values: [93.4] },
        { label: 'harbor-234', detail: 'pve2 · PVE-PROD', values: [91.9] },
      ],
    })

    const vcpus = chartFromToolResult('rank_guest_hardware', { ...RAM_RANKING, metric: 'vcpus', unit: 'vCPU' })

    expect(vcpus?.unit).toBe('vCPU')
    expect(vcpus?.rows.map(r => r.values[0])).toEqual([2, 4])
  })

  it('names a local pool after its host so same-named pools stay apart', () => {
    const chart = chartFromToolResult('rank_storage', STORAGE)

    expect(chart?.unit).toBe('%')
    expect(chart?.rows.map(r => r.label)).toEqual(['ZFS-Pool (pve1)', 'CephStoragePool', 'ZFS-Pool (pve3)'])
  })

  it('draws nothing for a single bar, an unknown metric or a tool without figures', () => {
    expect(chartFromToolResult('list_hosts', { hosts: [HOSTS.hosts[0]] })).toBeNull()
    expect(chartFromToolResult('rank_guest_hardware', { ...RAM_RANKING, metric: 'uptime' })).toBeNull()
    expect(chartFromToolResult('rank_guest_hardware', { ...RAM_RANKING, unit: 'TB' })).toBeNull()
    expect(chartFromToolResult('get_ceph_status', { health: 'HEALTH_ERR' })).toBeNull()
    expect(chartFromToolResult('list_hosts', null)).toBeNull()
    expect(chartFromToolResult('rank_storage', { ranking: 'none' })).toBeNull()
  })

  it('caps the bars a chat window can read', () => {
    const many = {
      hosts: Array.from({ length: 20 }, (_, i) => ({ name: `pve${i}`, cpuPct: i, memoryPct: i })),
    }

    expect(chartFromToolResult('list_hosts', many)?.rows).toHaveLength(MAX_CHART_ROWS)
  })
})

describe('collectCharts', () => {
  const hosts = chartFromToolResult('list_hosts', HOSTS)!
  const ram = chartFromToolResult('rank_guest_hardware', RAM_RANKING)!

  it('keeps the latest result per view, in the order the views first came', () => {
    const narrowed = { ...hosts, rows: hosts.rows.slice(0, 1) }

    expect(collectCharts([{ chart: hosts }, {}, { chart: ram }, { chart: narrowed }])).toEqual([narrowed, ram])
  })

  it('keeps two rankings on different metrics apart', () => {
    const vcpus = chartFromToolResult('rank_guest_hardware', { ...RAM_RANKING, metric: 'vcpus', unit: 'vCPU' })!

    expect(collectCharts([{ chart: ram }, { chart: vcpus }])).toHaveLength(2)
  })

  it('stops at a few charts per answer', () => {
    const full = { vcpus: 2, memoryGb: 4, diskGb: 32, cpuUsagePct: 12 }
    const ranking = RAM_RANKING.ranking.map(entry => ({ ...entry, ...full }))
    const charts = ['vcpus', 'memory', 'disk', 'cpu_usage'].map(
      metric => chartFromToolResult('rank_guest_hardware', { metric, unit: '%', ranking })!
    )

    expect(collectCharts(charts.map(chart => ({ chart })))).toHaveLength(MAX_CHARTS)
  })
})

describe('sanitizeChart', () => {
  const valid: AiChart = chartFromToolResult('rank_guest_hardware', RAM_RANKING)!

  it('returns a valid chart unchanged', () => {
    expect(sanitizeChart(JSON.parse(JSON.stringify(valid)))).toEqual(valid)
  })

  it('rejects anything that is not a chart', () => {
    expect(sanitizeChart(null)).toBeNull()
    expect(sanitizeChart({ ...valid, kind: 'pie' })).toBeNull()
    expect(sanitizeChart({ ...valid, unit: 'TB' })).toBeNull()
    expect(sanitizeChart({ ...valid, series: [] })).toBeNull()
    expect(sanitizeChart({ ...valid, series: ['a', 'b', 'c'] })).toBeNull()
    expect(sanitizeChart({ ...valid, rows: 'x' })).toBeNull()
    expect(sanitizeChart({ ...valid, rows: [{ label: 'a', values: ['93'] }] })).toBeNull()
    expect(sanitizeChart({ ...valid, rows: [{ label: '', values: [1] }] })).toBeNull()
  })

  it('drops rows past the cap', () => {
    const rows = Array.from({ length: 30 }, (_, i) => ({ label: `vm${i}`, values: [i] }))

    expect(sanitizeChart({ ...valid, rows })?.rows).toHaveLength(MAX_CHART_ROWS)
  })
})

describe('history charts', () => {
  const withSeries = (points: Array<{ time: number; values: number[] }>, over: Record<string, unknown> = {}) => ({
    target: 'pve1',
    [CHART_SERIES]: { target: 'pve1', metric: 'network', timeframe: 'week', unit: 'Mbit/s', series: ['in', 'out'], points, ...over },
  })
  const points = Array.from({ length: 70 }, (_, i) => ({ time: 1_790_000_000 + i * 600, values: [i, i / 2] }))

  it('draws the curve a history tool attached, keeping its latest points', () => {
    const chart = chartFromToolResult('get_metrics_history', withSeries(points))

    expect(chart).toMatchObject({ kind: 'history', metric: 'network', unit: 'Mbit/s', target: 'pve1', timeframe: 'week', series: ['in', 'out'] })
    expect(chart?.rows).toHaveLength(MAX_HISTORY_POINTS)
    expect(chart?.rows.at(-1)).toEqual({ label: '', time: points[69].time, values: [69, 34.5] })
  })

  it('draws nothing without a series, with a foreign unit or a single point', () => {
    expect(chartFromToolResult('get_metrics_history', { target: 'pve1' })).toBeNull()
    expect(chartFromToolResult('get_metrics_history', withSeries(points, { unit: 'bananas' }))).toBeNull()
    expect(chartFromToolResult('get_metrics_history', withSeries(points.slice(0, 1)))).toBeNull()
  })

  it('keeps one curve per target, metric and period', () => {
    const a = chartFromToolResult('get_metrics_history', withSeries(points))!
    const b = chartFromToolResult('get_metrics_history', withSeries(points, { timeframe: 'day' }))!

    expect(collectCharts([{ chart: a }, { chart: b }, { chart: a }])).toHaveLength(2)
  })

  it('reads a history chart back from the stream and rejects a broken one', () => {
    const chart = chartFromToolResult('get_metrics_history', withSeries(points))!

    expect(sanitizeChart(JSON.parse(JSON.stringify(chart)))).toEqual(chart)
    expect(sanitizeChart({ ...chart, timeframe: 'decade' })).toBeNull()
    expect(sanitizeChart({ ...chart, target: '' })).toBeNull()
    expect(sanitizeChart({ ...chart, rows: [{ label: '', values: [1, 2] }] })).toBeNull()
  })
})
