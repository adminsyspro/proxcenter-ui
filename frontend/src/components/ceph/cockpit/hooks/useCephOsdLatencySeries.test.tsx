import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'

import { jsonRes, swrWrapper } from './testUtils'
import { OSD_LATENCY_IDS_DEBOUNCE_MS, OSD_LATENCY_REFRESH_MS, useCephOsdLatencySeries } from './useCephOsdLatencySeries'

const fetchMock = vi.fn()
let tabVisible = true

vi.mock('@/hooks/usePageVisibility', () => ({ usePageVisible: () => tabVisible }))

const NONE = {}
const history = (osd_series: unknown) => ({ points: [], slowest_osds: [], osd_series })

beforeEach(() => {
  tabVisible = true
  fetchMock.mockReset()
  fetchMock.mockResolvedValue(jsonRes(history({ 0: [{ time: 1000, avg_ms: 1.5, max_ms: 4 }, { time: 1060, avg_ms: 2, max_ms: 3 }] })))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('useCephOsdLatencySeries, Enterprise', () => {
  it('asks the history for the ids of the page, sorted, with the cockpit period', async () => {
    const { result } = renderHook(() => useCephOsdLatencySeries('c 1', '24h', true, [7, 2, 2, 5], NONE), { wrapper: swrWrapper })

    await waitFor(() => expect(result.current.series[0]).toBeDefined())
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/orchestrator/ceph/c%201/history?range=24h&top=1&osds=2,5,7')
    expect(result.current.source).toBe('history')
    expect(result.current.series[0]).toEqual([{ time: 1_000_000, avg: 1.5, max: 4 }, { time: 1_060_000, avg: 2, max: 3 }])
  })

  it('Live asks for the last hour', async () => {
    renderHook(() => useCephOsdLatencySeries('c1', 'live', true, [0], NONE), { wrapper: swrWrapper })
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(fetchMock.mock.calls[0][0]).toContain('range=1h&')
  })

  it('does not call without ids or without a connection', async () => {
    renderHook(() => useCephOsdLatencySeries('c1', '1h', true, [], NONE), { wrapper: swrWrapper })
    renderHook(() => useCephOsdLatencySeries(null, '1h', true, [1], NONE), { wrapper: swrWrapper })
    await new Promise(r => setTimeout(r, 20))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('sends at most 100 ids', async () => {
    const ids = Array.from({ length: 130 }, (_, i) => i)

    renderHook(() => useCephOsdLatencySeries('c1', '1h', true, ids, NONE), { wrapper: swrWrapper })
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    expect(String(fetchMock.mock.calls[0][0]).split('osds=')[1].split(',')).toHaveLength(100)
  })

  it('a 404 is no data and no call loop', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404, json: async () => ({}) })
    const { result } = renderHook(() => useCephOsdLatencySeries('c1', '1h', true, [0], NONE), { wrapper: swrWrapper })

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    await new Promise(r => setTimeout(r, 30))
    expect(result.current.series).toEqual({})
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('an OSD with no sample is absent, malformed points are dropped', async () => {
    fetchMock.mockResolvedValue(jsonRes(history({ 1: [{ time: 1, avg_ms: 'x', max_ms: 2 }], 2: [] })))
    const { result } = renderHook(() => useCephOsdLatencySeries('c1', '1h', true, [1, 2, 3], NONE), { wrapper: swrWrapper })

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    await new Promise(r => setTimeout(r, 20))
    expect(result.current.series).toEqual({})
  })

  it('ignores the session buffer', async () => {
    const buffer = { 0: [{ time: 10, avg: 9, max: 9 }, { time: 20, avg: 9, max: 9 }, { time: 30, avg: 9, max: 9 }] }
    const { result } = renderHook(() => useCephOsdLatencySeries('c1', '1h', true, [0], buffer), { wrapper: swrWrapper })

    await waitFor(() => expect(result.current.series[0]).toHaveLength(2))
    expect(result.current.series[0][0].time).toBe(1_000_000)
  })

  it('never shows the curve of another cluster', async () => {
    let conn = 'ca'
    const { result, rerender } = renderHook(() => useCephOsdLatencySeries(conn, '1h', true, [0], NONE), { wrapper: swrWrapper })

    await waitFor(() => expect(result.current.series[0]).toBeDefined())
    fetchMock.mockImplementation(() => new Promise(() => {}))
    conn = 'cb'
    rerender()
    expect(result.current.series).toEqual({})
    expect(String(fetchMock.mock.calls.at(-1)?.[0])).toContain('/ceph/cb/history')
  })

  it('keeps the curves of the previous page while the next page loads', async () => {
    let ids = [0]
    const { result, rerender } = renderHook(() => useCephOsdLatencySeries('c1', '1h', true, ids, NONE), { wrapper: swrWrapper })

    await waitFor(() => expect(result.current.series[0]).toBeDefined())
    fetchMock.mockImplementation(() => new Promise(() => {}))
    vi.useFakeTimers()
    ids = [1]
    rerender()
    act(() => { vi.advanceTimersByTime(OSD_LATENCY_IDS_DEBOUNCE_MS + 10) })
    expect(result.current.series[0]).toBeDefined()
    vi.useRealTimers()
  })

  it('holds a burst of id changes (typing a search) for 300 ms: 3 quick changes, one call', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    let ids = [0, 1, 2]
    const { rerender } = renderHook(() => useCephOsdLatencySeries('c1', '1h', true, ids, NONE), { wrapper: swrWrapper })

    await act(async () => { await vi.advanceTimersByTimeAsync(10) })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    for (const next of [[1, 2], [2], [5]]) {
      ids = next
      rerender()
      await act(async () => { await vi.advanceTimersByTimeAsync(100) })
    }
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(OSD_LATENCY_IDS_DEBOUNCE_MS) })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(String(fetchMock.mock.calls[1][0])).toContain('osds=5')
    vi.useRealTimers()
  })

  it('refreshes every 5 minutes while the tab is visible', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    renderHook(() => useCephOsdLatencySeries('c1', '1h', true, [0], NONE), { wrapper: swrWrapper })
    await act(async () => { await vi.advanceTimersByTimeAsync(10) })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(OSD_LATENCY_REFRESH_MS - 1000) })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    vi.useRealTimers()
  })

  it('does not refresh in a hidden tab, however long it stays hidden', async () => {
    tabVisible = false
    vi.useFakeTimers({ shouldAdvanceTime: true })
    renderHook(() => useCephOsdLatencySeries('c1', '1h', true, [0], NONE), { wrapper: swrWrapper })
    await act(async () => { await vi.advanceTimersByTimeAsync(10) })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(OSD_LATENCY_REFRESH_MS * 3) })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })
})

describe('useCephOsdLatencySeries, Community', () => {
  it('never calls the API and returns the cockpit buffer as is', async () => {
    const buffer = { 0: [{ time: 1, avg: 1, max: 1 }] }
    const { result } = renderHook(() => useCephOsdLatencySeries('c1', '1h', false, [0, 1], buffer), { wrapper: swrWrapper })

    await new Promise(r => setTimeout(r, 20))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(result.current).toEqual({ series: buffer, source: 'session' })
  })
})
