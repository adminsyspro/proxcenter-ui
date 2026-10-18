import { afterEach, describe, expect, it, vi } from 'vitest'

import { fetchTargetNodeMetrics, jobsPerTargetNode, liveLoadColor, readNodeRrdPoint } from './targetNodeMetrics'

describe('readNodeRrdPoint', () => {
  it('reads the newest point that carries values, skipping the open minute', () => {
    const rows = [
      { time: 100, cpu: 0.1, iowait: 0.01, memused: 1, memtotal: 4, netin: 10 },
      { time: 160, cpu: 0.42, iowait: 0.03, memused: 3, memtotal: 4, netin: 2048 },
      { time: 220 },
    ]
    expect(readNodeRrdPoint(rows)).toEqual({ cpu: 0.42, iowait: 0.03, memUsed: 3, memTotal: 4, netin: 2048, time: 160 })
  })

  it('returns null without a usable point', () => {
    expect(readNodeRrdPoint(null)).toBeNull()
    expect(readNodeRrdPoint([{ time: 1 }])).toBeNull()
  })
})

describe('fetchTargetNodeMetrics', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('reads every node in one batch request and leaves out a node that did not answer', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: { '/nodes/pve1': [{ time: 1, cpu: 0.5, memused: 2, memtotal: 4, iowait: 0.1, netin: 5 }] } }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    const m = await fetchTargetNodeMetrics('c1', ['pve1', 'pve2'])
    expect(Object.keys(m)).toEqual(['pve1'])
    expect(m.pve1.cpu).toBe(0.5)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('/api/v1/connections/c1/rrd/batch')
    expect(JSON.parse(String(init.body))).toEqual({ paths: ['/nodes/pve1', '/nodes/pve2'], timeframe: 'hour' })
  })

  it('reads nothing without a connection or nodes', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    expect(await fetchTargetNodeMetrics('', ['pve1'])).toEqual({})
    expect(await fetchTargetNodeMetrics('c1', [])).toEqual({})
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('liveLoadColor', () => {
  it('turns orange past 85 % and red past 95 %', () => {
    expect(liveLoadColor(0.5)).toBe('success.main')
    expect(liveLoadColor(0.85)).toBe('success.main')
    expect(liveLoadColor(0.86)).toBe('warning.main')
    expect(liveLoadColor(0.96)).toBe('error.main')
  })
})

describe('jobsPerTargetNode', () => {
  it('counts the jobs of each node, running and queued apart', () => {
    expect(jobsPerTargetNode([
      { status: 'transferring', targetNode: 'pve1' },
      { status: 'queued', targetNode: 'pve1' },
      { status: 'completed', targetNode: 'pve1' },
      { status: 'queued', targetNode: 'pve2' },
      { status: 'queued' },
    ])).toEqual({ pve1: { total: 3, running: 1, queued: 1 }, pve2: { total: 1, running: 0, queued: 1 } })
  })
})
