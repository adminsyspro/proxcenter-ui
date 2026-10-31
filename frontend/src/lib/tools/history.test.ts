/**
 * get_metrics_history (#459): the one tool that reads Proxmox history, so the
 * tests pin its three load bounds (one read per target and period, a budget
 * per question, a shared in-flight read) and its security gate.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Host and storage permissions (#459): allowed unless a test says otherwise.
const perms = vi.hoisted(() => ({
  denied: new Set<string>(),
  hiddenStorages: new Set<string>(),
}))

vi.mock('@/lib/rbac', () => ({
  PERMISSIONS: { NODE_VIEW: 'node.view', NODE_NETWORK: 'node.network' },
  buildNodeResourceId: (connId: string, node: string) => `${connId}:${node}`,
  checkPermission: async (permission: string, type?: string, id?: string) =>
    perms.denied.has(`${permission}|${type ?? ''}|${id ?? ''}`) ? { status: 403 } : null,
}))
vi.mock('@/lib/storage/storageVisibility', () => ({
  resolveStorageCaller: async () => ({ allowed: true, denied: null, perimeter: null, infraScope: null, partial: false }),
  storageVisibilityFilter: async () => (row: { storage: string }) => !perms.hiddenStorages.has(row.storage),
}))

import { CHART_SERIES, chartFromToolResult } from '@/lib/ai/charts'
import { invokeTool } from './invoke'
import type { ToolContext } from './types'

const pveFetch = vi.fn()

vi.mock('@/lib/proxmox/client', () => ({ pveFetch: (...args: unknown[]) => pveFetch(...args) }))
vi.mock('@/lib/connections/getConnection', () => ({
  getConnectionById: async (id: string) => ({ id, name: id, baseUrl: 'https://pve:8006', apiToken: 't' }),
}))

import {
  clearHistoryCache,
  downsample,
  getMetricsHistoryTool,
  HISTORY_CHART_POINTS,
  MAX_HISTORY_LOOKUPS_PER_QUESTION,
} from './history'

const makeCtx = (): ToolContext => ({
  snapshot: {
    clusters: [{ id: 'c1', name: 'PVE-PROD', nodeCount: 1, guestCount: 1 }],
    nodes: [{ connId: 'c1', cluster: 'PVE-PROD', name: 'pve1', status: 'online', cpuPct: 1, memPct: 1, memUsedGb: 1, memTotalGb: 8 }],
    guests: [
      {
        connId: 'c1',
        cluster: 'PVE-PROD',
        vmid: '231',
        name: 'ha-airgap-231',
        type: 'VM',
        kind: 'qemu',
        status: 'running',
        node: 'pve1',
        cpuPct: 2,
        memPct: 20,
        memUsedGb: 3,
        memTotalGb: 14,
        template: false,
      },
    ],
    summary: { totalGuests: 1, runningGuests: 1, stoppedGuests: 0, totalNodes: 1, onlineNodes: 1 },
    cached: false,
  },
  tenantId: 't',
  locale: 'fr',
  timeZone: 'Europe/Paris',
  usage: { historyLookups: 0 },
})

const now = Math.floor(Date.now() / 1000)

/** A day of minute rows, CPU climbing to a peak 10 minutes ago. */
const dayRows = Array.from({ length: 1440 }, (_, i) => ({
  time: now - (1440 - i) * 60,
  cpu: i === 1430 ? 0.9 : 0.02,
  mem: 3e9,
  maxmem: 15e9,
  netin: 125_000,
  netout: 62_500,
  diskread: 2e6,
  diskwrite: 1e6,
}))

beforeEach(() => {
  perms.denied.clear()
  perms.hiddenStorages.clear()
  clearHistoryCache()
  pveFetch.mockReset().mockResolvedValue(dayRows)
})

describe('get_metrics_history', () => {
  it('reads the guest path built from the snapshot and summarises the series for the model', async () => {
    const res = (await getMetricsHistoryTool.execute({ guest: 'ha-airgap-231', metric: 'cpu', timeframe: 'day' }, makeCtx())) as any

    expect(pveFetch).toHaveBeenCalledTimes(1)
    expect(pveFetch.mock.calls[0][1]).toBe('/nodes/pve1/qemu/231/rrddata?timeframe=day&cf=AVERAGE')
    expect(res).toMatchObject({ target: 'ha-airgap-231', targetType: 'guest', cluster: 'PVE-PROD', metric: 'cpu', unit: '%' })
    expect(res.summary.cpu.peak).toBe(90)
    expect(res.summary.cpu.average).toBeLessThan(3)
    // In the reader's zone, never a bare UTC instant.
    expect(res.summary.cpu.peakAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
  })

  it('keeps the curve out of what the model reads and hands it to the chart', async () => {
    const res = await getMetricsHistoryTool.execute({ guest: '231', metric: 'memory' }, makeCtx())

    expect(JSON.stringify(res)).not.toContain('points":[')

    const chart = chartFromToolResult('get_metrics_history', res)

    expect(chart).toMatchObject({ kind: 'history', metric: 'memory', unit: '%', target: 'ha-airgap-231', timeframe: 'day' })
    expect(chart?.rows.length).toBeLessThanOrEqual(HISTORY_CHART_POINTS)
    expect(chart?.rows[0].values[0]).toBe(20)
  })

  it('converts network bytes to Mbit/s and disk bytes to MB/s', async () => {
    const net = (await getMetricsHistoryTool.execute({ node: 'pve1', metric: 'network' }, makeCtx())) as any

    expect(net.unit).toBe('Mbit/s')
    expect(net.summary.in.average).toBe(1)
    expect(net.summary.out.average).toBe(0.5)

    const disk = (await getMetricsHistoryTool.execute({ guest: 'ha-airgap-231', metric: 'disk_io' }, makeCtx())) as any

    expect(disk.unit).toBe('MB/s')
    expect(disk.summary.read.average).toBe(2)
  })

  it('never calls Proxmox for a target outside the snapshot', async () => {
    const out = await invokeTool(getMetricsHistoryTool, { guest: 'other-tenant-vm' }, makeCtx())

    expect(out).toMatchObject({ ok: false, error: 'out-of-scope' })
    expect(pveFetch).not.toHaveBeenCalled()
  })

  it('refuses the history of a host the caller may not view, even when a guest of theirs runs on it', async () => {
    perms.denied.add('node.view|node|c1:pve1')

    expect(await invokeTool(getMetricsHistoryTool, { node: 'pve1' }, makeCtx())).toMatchObject({ ok: false, error: 'out-of-scope' })
    expect(await invokeTool(getMetricsHistoryTool, { guest: '231' }, makeCtx())).toMatchObject({ ok: true })
    expect(pveFetch).toHaveBeenCalledTimes(1)
  })

  it('refuses ambiguous or meaningless requests before any call', async () => {
    expect(await invokeTool(getMetricsHistoryTool, { node: 'pve1', guest: '231' }, makeCtx())).toMatchObject({ error: 'bad-argument' })
    expect(await invokeTool(getMetricsHistoryTool, {}, makeCtx())).toMatchObject({ error: 'bad-argument' })
    expect(await invokeTool(getMetricsHistoryTool, { node: 'pve1', metric: 'disk_io' }, makeCtx())).toMatchObject({ error: 'bad-argument' })
    expect(pveFetch).not.toHaveBeenCalled()
  })

  it('serves CPU then RAM of the same guest from one Proxmox read, even in parallel', async () => {
    const ctx = makeCtx()

    await Promise.all([
      getMetricsHistoryTool.execute({ guest: '231', metric: 'cpu' }, ctx),
      getMetricsHistoryTool.execute({ guest: '231', metric: 'memory' }, ctx),
    ])

    expect(pveFetch).toHaveBeenCalledTimes(1)
    expect(ctx.usage?.historyLookups).toBe(1)
  })

  it('stops reading Proxmox once the budget of the question is spent', async () => {
    const ctx = makeCtx()
    const timeframes = ['hour', 'day', 'week', 'month', 'year']

    for (const timeframe of timeframes) await getMetricsHistoryTool.execute({ node: 'pve1', timeframe }, ctx)
    await getMetricsHistoryTool.execute({ guest: '231', timeframe: 'hour' }, ctx)

    expect(pveFetch).toHaveBeenCalledTimes(MAX_HISTORY_LOOKUPS_PER_QUESTION)

    const over = await invokeTool(getMetricsHistoryTool, { guest: '231', timeframe: 'week' }, ctx)

    expect(over).toMatchObject({ ok: false, error: 'out-of-scope' })
    expect(pveFetch).toHaveBeenCalledTimes(MAX_HISTORY_LOOKUPS_PER_QUESTION)
  })

  it('does not keep a failed read, so the next question tries again', async () => {
    pveFetch.mockRejectedValueOnce(new Error('pveproxy timeout'))

    expect(await invokeTool(getMetricsHistoryTool, { node: 'pve1' }, makeCtx())).toMatchObject({ ok: false, error: 'failed' })
    expect(await invokeTool(getMetricsHistoryTool, { node: 'pve1' }, makeCtx())).toMatchObject({ ok: true })
    expect(pveFetch).toHaveBeenCalledTimes(2)
  })

  it('says so when Proxmox has no reading for the period', async () => {
    pveFetch.mockResolvedValueOnce([])

    const res = (await getMetricsHistoryTool.execute({ guest: '231' }, makeCtx())) as any

    expect(res.summary).toBeNull()
    expect(res.note).toMatch(/no reading/)
    expect(chartFromToolResult('get_metrics_history', res)).toBeNull()
    expect((res as Record<symbol, unknown>)[CHART_SERIES]).toBeUndefined()
  })
})

describe('downsample', () => {
  it('averages consecutive points into the target count, ignoring gaps', () => {
    const points = Array.from({ length: 10 }, (_, i) => ({ time: i, values: [i % 2 ? null : i] }))
    const out = downsample(points, 5)

    expect(out).toHaveLength(5)
    expect(out.map(p => p.values[0])).toEqual([0, 2, 4, 6, 8])
    expect(out.map(p => p.time)).toEqual([1, 3, 5, 7, 9])
  })

  it('leaves a short series alone', () => {
    const points = [{ time: 1, values: [1] }]

    expect(downsample(points, 60)).toBe(points)
  })
})
