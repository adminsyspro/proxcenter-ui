import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'

import { swrWrapper } from './testUtils'
import { OSD_EXPORTER_BACKOFF_MS, OSD_EXPORTER_POLL_MS, useOsdExporterLive } from './useOsdExporterLive'

const fetchMock = vi.fn()
let tabVisible = true

vi.mock('@/hooks/usePageVisibility', () => ({ usePageVisible: () => tabVisible }))

const counters = (at: number, over: Record<string, number> = {}) => ({ osd: 0, at, op_r: 1000, op_w: 500, op_r_out_bytes: 1_000_000, op_w_in_bytes: 2_000_000, ...over })
const ok = (data: unknown) => ({ ok: true, status: 200, json: async () => ({ data }) })
const fail = (status: number, body: unknown) => ({ ok: false, status, json: async () => body })
const flush = async (ms = 0) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }

beforeEach(() => {
  vi.useFakeTimers()
  tabVisible = true
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('useOsdExporterLive', () => {
  it('makes no call while the sheet is closed or the node is unknown', async () => {
    renderHook(() => useOsdExporterLive('c1', 'pve1', 0, false), { wrapper: swrWrapper })
    renderHook(() => useOsdExporterLive('c1', null, 0, true), { wrapper: swrWrapper })
    renderHook(() => useOsdExporterLive(null, 'pve1', 0, true), { wrapper: swrWrapper })
    await flush(OSD_EXPORTER_POLL_MS * 3)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('reads the exporter route of the node, then every 5 s, and derives the rates by difference', async () => {
    fetchMock
      .mockResolvedValueOnce(ok(counters(10_000)))
      .mockResolvedValueOnce(ok(counters(15_000, { op_r: 1100, op_w: 520, op_r_out_bytes: 1_050_000, op_w_in_bytes: 2_500_000 })))
    const { result } = renderHook(() => useOsdExporterLive('c 1', 'pve 1', 0, true), { wrapper: swrWrapper })

    await flush()
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/connections/c%201/nodes/pve%201/ceph/exporter?osd=0')
    expect(result.current).toMatchObject({ status: 'ok', points: [] })
    await flush(OSD_EXPORTER_POLL_MS)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.current.points).toEqual([{ time: 15_000, readOps: 20, writeOps: 4, readBytes: 10_000, writeBytes: 100_000 }])
  })

  it('a counter that goes down (OSD restart) makes no point and starts a new reference', async () => {
    fetchMock
      .mockResolvedValueOnce(ok(counters(10_000)))
      .mockResolvedValueOnce(ok(counters(15_000, { op_r: 3 })))
      .mockResolvedValueOnce(ok(counters(20_000, { op_r: 53 })))
    const { result } = renderHook(() => useOsdExporterLive('c1', 'pve1', 0, true), { wrapper: swrWrapper })

    await flush(OSD_EXPORTER_POLL_MS)
    expect(result.current.points).toEqual([])
    await flush(OSD_EXPORTER_POLL_MS)
    expect(result.current.points.map(p => p.readOps)).toEqual([10])
  })

  it('keeps the last 5 minutes only', async () => {
    let at = 0
    fetchMock.mockImplementation(async () => ok(counters((at += 5000), { op_r: at })))
    const { result } = renderHook(() => useOsdExporterLive('c1', 'pve1', 0, true), { wrapper: swrWrapper })

    await flush(OSD_EXPORTER_POLL_MS * 80)
    const times = result.current.points.map(p => p.time)

    expect(times.at(-1)! - times[0]).toBeLessThanOrEqual(300_000)
    expect(times.length).toBeLessThanOrEqual(61)
    expect(times.length).toBeGreaterThan(55)
  })

  it('503 exporter_unreachable and 404 osd_not_exported are distinct states, polled less often', async () => {
    fetchMock.mockResolvedValue(fail(503, { code: 'exporter_unreachable' }))
    const a = renderHook(() => useOsdExporterLive('c1', 'pve1', 0, true), { wrapper: swrWrapper })

    await flush()
    expect(a.result.current.status).toBe('unreachable')
    // The first timer is armed before the state is known (5 s); once unreachable, the next reads wait 30 s.
    await flush(OSD_EXPORTER_POLL_MS)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await flush(OSD_EXPORTER_BACKOFF_MS - 1000)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await flush(1000)
    expect(fetchMock).toHaveBeenCalledTimes(3)

    fetchMock.mockReset()
    fetchMock.mockResolvedValue(fail(404, { code: 'osd_not_exported' }))
    const b = renderHook(() => useOsdExporterLive('c1', 'pve2', 1, true), { wrapper: swrWrapper })

    await flush()
    expect(b.result.current.status).toBe('not_exported')
  })

  it('any other failure is a plain error and never an exporter state', async () => {
    fetchMock.mockResolvedValueOnce(fail(404, { error: 'Node not found in this connection' }))
    const a = renderHook(() => useOsdExporterLive('c1', 'pve1', 0, true), { wrapper: swrWrapper })

    await flush()
    expect(a.result.current.status).toBe('error')

    fetchMock.mockReset()
    fetchMock.mockRejectedValue(new Error('network'))
    const b = renderHook(() => useOsdExporterLive('c1', 'pve2', 0, true), { wrapper: swrWrapper })

    await flush()
    expect(b.result.current.status).toBe('error')

    fetchMock.mockReset()
    fetchMock.mockResolvedValue(ok({ at: 1 }))
    const c = renderHook(() => useOsdExporterLive('c1', 'pve3', 0, true), { wrapper: swrWrapper })

    await flush()
    expect(c.result.current.status).toBe('error')
  })

  it('keeps polling every 5 s when the host component re-renders more often than that', async () => {
    let at = 0
    fetchMock.mockImplementation(async () => ok(counters((at += 5000), { op_r: at })))
    const { rerender } = renderHook(() => useOsdExporterLive('c1', 'pve1', 0, true), { wrapper: swrWrapper })

    for (let i = 0; i < 12; i++) {
      await flush(1000)
      rerender()
    }
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(3)
  })

  it('keeps the reason of the 503: refused, timeout or invalid; none, or an unknown one, is the generic case', async () => {
    for (const reason of ['refused', 'timeout', 'invalid'] as const) {
      fetchMock.mockReset()
      fetchMock.mockResolvedValue(fail(503, { code: 'exporter_unreachable', reason }))
      const { result, unmount } = renderHook(() => useOsdExporterLive('c1', 'pve1', 0, true), { wrapper: swrWrapper })

      await flush()
      expect(result.current.status).toBe('unreachable')
      expect(result.current.reason, reason).toBe(reason)
      unmount()
    }

    for (const body of [{ code: 'exporter_unreachable' }, { code: 'exporter_unreachable', reason: 'boom' }, { code: 'exporter_unreachable', reason: 7 }]) {
      fetchMock.mockReset()
      fetchMock.mockResolvedValue(fail(503, body))
      const { result, unmount } = renderHook(() => useOsdExporterLive('c1', 'pve1', 0, true), { wrapper: swrWrapper })

      await flush()
      expect(result.current.status).toBe('unreachable')
      expect(result.current.reason).toBeUndefined()
      unmount()
    }
  })

  it('a read failure backs off to 30 s like an unreachable exporter', async () => {
    fetchMock.mockResolvedValue(fail(500, {}))
    const { result } = renderHook(() => useOsdExporterLive('c1', 'pve1', 0, true), { wrapper: swrWrapper })

    await flush()
    expect(result.current.status).toBe('error')
    await flush(OSD_EXPORTER_POLL_MS)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await flush(OSD_EXPORTER_BACKOFF_MS - 1000)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await flush(1000)
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('hidden then visible again: the calls resume, and a gap over 30 s makes no point', async () => {
    const samples = [10_000, 15_000, 75_000, 80_000]
    let i = 0
    fetchMock.mockImplementation(async () => { const at = samples[i++] ?? 90_000; return ok(counters(at, { op_r: at })) })
    const { result, rerender } = renderHook(() => useOsdExporterLive('c1', 'pve1', 0, true), { wrapper: swrWrapper })

    await flush(OSD_EXPORTER_POLL_MS)
    expect(result.current.points).toHaveLength(1)
    tabVisible = false
    rerender()
    await flush(OSD_EXPORTER_POLL_MS * 6)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    tabVisible = true
    rerender()
    await flush(OSD_EXPORTER_POLL_MS)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    // 15 000 -> 75 000: too far apart, the previous point stays and nothing is added.
    expect(result.current.points).toHaveLength(1)
    await flush(OSD_EXPORTER_POLL_MS)
    expect(result.current.points).toHaveLength(2)
    expect(result.current.points.at(-1)?.time).toBe(80_000)
  })

  it('does not poll while the tab is hidden', async () => {
    tabVisible = false
    fetchMock.mockResolvedValue(ok(counters(1)))
    renderHook(() => useOsdExporterLive('c1', 'pve1', 0, true), { wrapper: swrWrapper })

    await flush(OSD_EXPORTER_POLL_MS * 4)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('another OSD starts from an empty buffer', async () => {
    let at = 0
    fetchMock.mockImplementation(async () => ok(counters((at += 5000), { op_r: at })))
    let osd = 0
    const { result, rerender } = renderHook(() => useOsdExporterLive('c1', 'pve1', osd, true), { wrapper: swrWrapper })

    await flush(OSD_EXPORTER_POLL_MS * 3)
    expect(result.current.points.length).toBeGreaterThan(1)
    osd = 1
    rerender()
    await flush()
    expect(result.current.points).toEqual([])
  })
})
