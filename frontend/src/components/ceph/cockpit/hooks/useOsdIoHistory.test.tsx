import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, renderHook, waitFor } from '@testing-library/react'

import { jsonRes, swrWrapper } from './testUtils'
import { useOsdIoHistory } from './useOsdIoHistory'

const fetchMock = vi.fn()

vi.mock('@/hooks/usePageVisibility', () => ({ usePageVisible: () => true }))

const history = (osd_io_series: unknown) => ({ points: [], slowest_osds: [], osd_io_series })
const pt = (time: number, r = 1) => ({ time, read_ops: r, write_ops: 2, read_bytes: 3, write_bytes: 4 })

beforeEach(() => {
  fetchMock.mockReset()
  fetchMock.mockResolvedValue(jsonRes(history({ 2: [pt(1000, 5), pt(1060, 6)] })))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('useOsdIoHistory', () => {
  it('Enterprise: asks osd_io for the OSD with the cockpit period and converts seconds to ms', async () => {
    const { result } = renderHook(() => useOsdIoHistory('c 1', 2, '24h', true, true), { wrapper: swrWrapper })

    await waitFor(() => expect(result.current.points).toHaveLength(2))
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/orchestrator/ceph/c%201/history?range=24h&top=1&osds=2&osd_io=1')
    expect(result.current.points[0]).toEqual({ time: 1_000_000, readOps: 5, writeOps: 2, readBytes: 3, writeBytes: 4 })
    expect(result.current.state).toBe('ready')
  })

  it('Live asks for the last hour and reads as live', async () => {
    const { result } = renderHook(() => useOsdIoHistory('c1', 2, 'live', true, true), { wrapper: swrWrapper })

    await waitFor(() => expect(result.current.points).toHaveLength(2))
    expect(fetchMock.mock.calls[0][0]).toContain('range=1h&')
    expect(result.current.state).toBe('live')
  })

  it('Community, closed sheet or no connection: no call', async () => {
    renderHook(() => useOsdIoHistory('c1', 2, '1h', false, true), { wrapper: swrWrapper })
    renderHook(() => useOsdIoHistory('c1', 2, '1h', true, false), { wrapper: swrWrapper })
    renderHook(() => useOsdIoHistory(null, 2, '1h', true, true), { wrapper: swrWrapper })
    await new Promise(r => setTimeout(r, 20))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('an OSD with no stored data gives no point; a 404 reads as unavailable over a period', async () => {
    fetchMock.mockResolvedValueOnce(jsonRes(history({})))
    const a = renderHook(() => useOsdIoHistory('c1', 2, '7d', true, true), { wrapper: swrWrapper })

    await waitFor(() => expect(a.result.current.state).toBe('ready'))
    expect(a.result.current.points).toEqual([])

    fetchMock.mockResolvedValueOnce(jsonRes({}, 404))
    const b = renderHook(() => useOsdIoHistory('c2', 2, '7d', true, true), { wrapper: swrWrapper })

    await waitFor(() => expect(b.result.current.state).toBe('unavailable'))
  })

  it('licence Enterprise -> Community while open: no more points served, no more calls', async () => {
    let enterprise = true
    const { result, rerender } = renderHook(() => useOsdIoHistory('c1', 2, '24h', enterprise, true), { wrapper: swrWrapper })

    await waitFor(() => expect(result.current.points).toHaveLength(2))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    enterprise = false
    rerender()
    expect(result.current).toEqual({ points: [], state: 'live' })
    await new Promise(r => setTimeout(r, 30))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('drops malformed points', async () => {
    fetchMock.mockResolvedValueOnce(jsonRes(history({ 2: [pt(1000), { time: 1060, read_ops: 'x' }, null, pt(1120)] })))
    const { result } = renderHook(() => useOsdIoHistory('c1', 2, '1h', true, true), { wrapper: swrWrapper })

    await waitFor(() => expect(result.current.points).toHaveLength(2))
  })
})
