import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { cleanup, renderHook, waitFor } from '@testing-library/react'

import { useNodeTrends } from './useNodeTrends'

afterEach(cleanup)
beforeEach(() => {
  vi.restoreAllMocks()
})

const CPU_RAM = ['cpu', 'ram']
const ARC = ['arc', 'arcPct']

const jsonResponse = (body: unknown) => ({ ok: true, json: async () => body }) as Response

const clusterData = {
  clusters: [{ id: 'c1', name: 'cluster-1' }],
  nodes: [
    { name: 'pve-01', node: 'pve-01', connectionId: 'c1' },
    { name: 'pve-02', node: 'pve-02', connectionId: 'c1' },
  ],
}

describe('useNodeTrends', () => {
  it('merges every node of every connection into one time-indexed series', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      data: {
        'node:pve-01': [{ ts: 1, t: '10:00', cpu: 12, ram: 34 }],
        'node:pve-02': [{ ts: 1, t: '10:00', cpu: 7, ram: 51 }],
      },
    })))

    const { result } = renderHook(() => useNodeTrends({
      data: clusterData, selectedConnections: [], timeRange: '1h', metrics: CPU_RAM,
    }))

    await waitFor(() => expect(result.current.trendsData).not.toBeNull())
    expect(result.current.nodeNames).toEqual(['pve-01', 'pve-02'])
    expect(result.current.trendsData?.[0]).toMatchObject({
      't': '10:00', 'pve-01_cpu': 12, 'pve-01_ram': 34, 'pve-02_cpu': 7, 'pve-02_ram': 51,
    })
  })

  it('falls back to the connections carried by the nodes when there is no cluster', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: {} })))

    const { result } = renderHook(() => useNodeTrends({
      data: { nodes: [
        { name: 'pve-09', connId: 'c9', connection: 'Lab' },
        { name: 'pve-10', connId: 'c9', connection: 'Lab' },
      ] },
      selectedConnections: [], timeRange: '1h', metrics: CPU_RAM,
    }))

    await waitFor(() => expect(result.current.allConnections).toHaveLength(1))
    expect(result.current.allConnections[0]).toEqual({ id: 'c9', name: 'Lab' })
  })

  it('names a connection by its id when the node carries no label', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ data: {} })))

    const { result } = renderHook(() => useNodeTrends({
      data: { nodes: [{ name: 'pve-09', connectionId: 'c9' }] },
      selectedConnections: [], timeRange: '1h', metrics: CPU_RAM,
    }))

    await waitFor(() => expect(result.current.allConnections).toHaveLength(1))
    expect(result.current.allConnections[0]).toEqual({ id: 'c9', name: 'c9' })
  })

  it('ignores a filter that only references connections which no longer exist', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ data: {} }))

    vi.stubGlobal('fetch', fetchMock)

    renderHook(() => useNodeTrends({
      data: clusterData, selectedConnections: ['gone'], timeRange: '1h', metrics: CPU_RAM,
    }))

    // Both nodes of c1 are still requested: a stale filter must not empty the chart.
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1))
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/connections/c1/nodes/trends')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).items).toEqual([{ node: 'pve-01' }, { node: 'pve-02' }])
  })

  it('fills a gap forward and backward for a node whose RRD lags behind', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      data: {
        'node:pve-01': [
          { ts: 1, t: '10:00', cpu: 10, ram: 20 },
          { ts: 2, t: '10:01', cpu: 11, ram: 21 },
          { ts: 3, t: '10:02', cpu: 12, ram: 22 },
        ],
        'node:pve-02': [{ ts: 2, t: '10:01', cpu: 50, ram: 60 }],
      },
    })))

    const { result } = renderHook(() => useNodeTrends({
      data: clusterData, selectedConnections: [], timeRange: '1h', metrics: CPU_RAM,
    }))

    await waitFor(() => expect(result.current.trendsData).toHaveLength(3))
    const series = result.current.trendsData as Record<string, number>[]

    expect(series[0]['pve-02_cpu']).toBe(50) // backward fill
    expect(series[2]['pve-02_cpu']).toBe(50) // forward fill
  })

  it('keeps a missing metric null when the caller asked for null', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      data: { 'node:pve-01': [{ ts: 1, t: '10:00', arc: null, arcPct: null }] },
    })))

    const { result } = renderHook(() => useNodeTrends({
      data: clusterData, selectedConnections: [], timeRange: '1h', metrics: ARC, defaultValue: null,
    }))

    await waitFor(() => expect(result.current.trendsData).toHaveLength(1))
    expect(result.current.trendsData?.[0]['pve-01_arc']).toBeNull()
  })

  it('indexes a point that carries no timestamp by its label', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      data: { 'node:pve-01': [{ t: '10:00', cpu: 5, ram: 6 }] },
    })))

    const { result } = renderHook(() => useNodeTrends({
      data: clusterData, selectedConnections: [], timeRange: '1h', metrics: CPU_RAM,
    }))

    await waitFor(() => expect(result.current.trendsData).toHaveLength(1))
    expect(result.current.trendsData?.[0]).toMatchObject({ ts: 0, t: '10:00', 'pve-01_cpu': 5 })
  })

  it('ignores a connection whose payload is not a series', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({
      data: { 'node:pve-01': null, 'node:pve-02': [{ ts: 1, t: '10:00', cpu: 1, ram: 2 }] },
    })))

    const { result } = renderHook(() => useNodeTrends({
      data: clusterData, selectedConnections: [], timeRange: '1h', metrics: CPU_RAM,
    }))

    await waitFor(() => expect(result.current.trendsData).toHaveLength(1))
    expect(result.current.nodeNames).toEqual(['pve-01', 'pve-02'])
  })

  it('drops the payload of a connection that answers with an error status', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) } as Response))

    const { result } = renderHook(() => useNodeTrends({
      data: clusterData, selectedConnections: [], timeRange: '1h', metrics: CPU_RAM,
    }))

    await waitFor(() => expect(result.current.trendsData).toEqual([]))
    expect(result.current.nodeNames).toEqual([])
  })

  it('empties the series when the request throws', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    vi.spyOn(console, 'error').mockImplementation(() => {})

    const { result } = renderHook(() => useNodeTrends({
      data: clusterData, selectedConnections: [], timeRange: '1h', metrics: CPU_RAM,
    }))

    await waitFor(() => expect(result.current.trendsData).toEqual([]))
  })

  it('does not call the endpoint when no node carries a connection', async () => {
    const fetchMock = vi.fn()

    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useNodeTrends({
      data: { nodes: [{ name: 'orphan' }] }, selectedConnections: [], timeRange: '1h', metrics: CPU_RAM,
    }))

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.current.trendsData).toBeNull()
  })
})
