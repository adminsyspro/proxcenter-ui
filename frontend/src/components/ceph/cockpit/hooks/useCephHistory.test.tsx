import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'

import { jsonRes, swrWrapper } from './testUtils'
import { HISTORY_REFRESH_S, useCephHistory, useCephLastHour, useRefreshCephHistory } from './useCephHistory'

const fetchMock = vi.fn()
let tabVisible = true

// SWR ecoute visibilitychange avec un setTimeout.bind qui recoit l'evenement comme delai : visibilite pilotee par mock.
vi.mock('@/hooks/usePageVisibility', () => ({ usePageVisible: () => tabVisible }))

beforeEach(() => {
  tabVisible = true
  fetchMock.mockReset()
  fetchMock.mockResolvedValue(jsonRes({ points: [], slowest_osds: [] }))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('useCephHistory', () => {
  it('history does not fetch in live or community', async () => {
    renderHook(() => useCephHistory('c1', 'live', true), { wrapper: swrWrapper })
    renderHook(() => useCephHistory('c1', '24h', false), { wrapper: swrWrapper })
    renderHook(() => useCephHistory(null, '24h', true), { wrapper: swrWrapper })
    await new Promise(r => setTimeout(r, 20))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('fetches the range in Enterprise', async () => {
    const { result } = renderHook(() => useCephHistory('c 1', '7d', true), { wrapper: swrWrapper })

    await waitFor(() => expect(result.current.history).not.toBeNull())
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/orchestrator/ceph/c%201/history?range=7d')
  })

  it('history 404 yields null without error', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404, json: async () => ({}) })
    const { result } = renderHook(() => useCephHistory('c1', '1h', true), { wrapper: swrWrapper })

    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.history).toBeNull()
    expect(result.current.error).toBeNull()
  })

  it('surfaces a real error', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })
    const { result } = renderHook(() => useCephHistory('c1', '1h', true), { wrapper: swrWrapper })

    await waitFor(() => expect(result.current.error).not.toBeNull())
  })

  it('revalidates once on resume when in error, never without error', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })
    tabVisible = false
    const { result, rerender } = renderHook(() => useCephHistory('c1', '24h', true), { wrapper: swrWrapper })

    await waitFor(() => expect(result.current.error).not.toBeNull())
    expect(fetchMock).toHaveBeenCalledTimes(1)

    tabVisible = true
    rerender()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    await new Promise(r => setTimeout(r, 30))
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('no call on resume without error', async () => {
    const { result, rerender } = renderHook(() => useCephHistory('c1', '24h', true), { wrapper: swrWrapper })

    await waitFor(() => expect(result.current.history).not.toBeNull())
    expect(fetchMock).toHaveBeenCalledTimes(1)
    tabVisible = false
    rerender()
    tabVisible = true
    rerender()
    await new Promise(r => setTimeout(r, 30))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('refreshes at the pace of the period while the tab is visible, never hidden', async () => {
    vi.useFakeTimers()
    try {
      for (const range of ['1h', '24h', '7d', '30d'] as const) {
        fetchMock.mockClear()
        tabVisible = true
        const { unmount } = renderHook(() => useCephHistory('c1', range, true), { wrapper: swrWrapper })

        await act(async () => { await vi.advanceTimersByTimeAsync(0) })
        expect(fetchMock).toHaveBeenCalledTimes(1)
        await act(async () => { await vi.advanceTimersByTimeAsync(HISTORY_REFRESH_S[range] * 1000 - 1000) })
        expect(fetchMock, range).toHaveBeenCalledTimes(1)
        await act(async () => { await vi.advanceTimersByTimeAsync(1500) })
        expect(fetchMock, range).toHaveBeenCalledTimes(2)
        unmount()
      }
      expect(HISTORY_REFRESH_S).toEqual({ '1h': 60, '24h': 300, '7d': 1800, '30d': 7200 })

      fetchMock.mockClear()
      tabVisible = false
      renderHook(() => useCephHistory('c1', '1h', true), { wrapper: swrWrapper })
      await act(async () => { await vi.advanceTimersByTimeAsync(0) })
      const first = fetchMock.mock.calls.length

      await act(async () => { await vi.advanceTimersByTimeAsync(600_000) })
      expect(fetchMock).toHaveBeenCalledTimes(first)
    } finally {
      vi.useRealTimers()
    }
  })

  it('the refresh hook revalidates the open histories', async () => {
    const { result } = renderHook(() => ({ h: useCephHistory('c1', '1h', true), refresh: useRefreshCephHistory() }), { wrapper: swrWrapper })

    await waitFor(() => expect(result.current.h.history).not.toBeNull())
    expect(fetchMock).toHaveBeenCalledTimes(1)
    act(() => result.current.refresh())
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  })
})

describe('useCephLastHour', () => {
  it('fetches the 1 h history once, and nothing when disabled or without a connection', async () => {
    renderHook(() => useCephLastHour('c1', false), { wrapper: swrWrapper })
    renderHook(() => useCephLastHour(null, true), { wrapper: swrWrapper })
    await new Promise(r => setTimeout(r, 20))
    expect(fetchMock).not.toHaveBeenCalled()

    const { result } = renderHook(() => useCephLastHour('c1', true), { wrapper: swrWrapper })

    await waitFor(() => expect(result.current.history).not.toBeNull())
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/orchestrator/ceph/c1/history?range=1h')
  })

  it('shares the call with another consumer of the 1 h period', async () => {
    const { result } = renderHook(() => ({ a: useCephHistory('c1', '1h', true), b: useCephLastHour('c1', true) }), { wrapper: swrWrapper })

    await waitFor(() => expect(result.current.b.history).not.toBeNull())
    expect(result.current.a.history).toBe(result.current.b.history)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('refreshes every minute while visible, never while hidden', async () => {
    vi.useFakeTimers()
    try {
      const { unmount } = renderHook(() => useCephLastHour('c1', true), { wrapper: swrWrapper })

      await act(async () => { await vi.advanceTimersByTimeAsync(0) })
      expect(fetchMock).toHaveBeenCalledTimes(1)
      await act(async () => { await vi.advanceTimersByTimeAsync(61_000) })
      expect(fetchMock).toHaveBeenCalledTimes(2)
      unmount()

      fetchMock.mockClear()
      tabVisible = false
      renderHook(() => useCephLastHour('c1', true), { wrapper: swrWrapper })
      await act(async () => { await vi.advanceTimersByTimeAsync(0) })
      const first = fetchMock.mock.calls.length

      await act(async () => { await vi.advanceTimersByTimeAsync(600_000) })
      expect(fetchMock).toHaveBeenCalledTimes(first)
    } finally {
      vi.useRealTimers()
    }
  })

  it('reads the history once when the tab becomes visible again', async () => {
    const { result, rerender } = renderHook(() => useCephLastHour('c1', true), { wrapper: swrWrapper })

    await waitFor(() => expect(result.current.history).not.toBeNull())
    expect(fetchMock).toHaveBeenCalledTimes(1)
    tabVisible = false
    rerender()
    await new Promise(r => setTimeout(r, 30))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    tabVisible = true
    rerender()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
  })

  it('in error, the resume rereads once, not twice', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })
    tabVisible = false
    const { result, rerender } = renderHook(() => useCephLastHour('c1', true), { wrapper: swrWrapper })

    await waitFor(() => expect(result.current.error).not.toBeNull())
    expect(fetchMock).toHaveBeenCalledTimes(1)
    tabVisible = true
    rerender()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    await new Promise(r => setTimeout(r, 50))
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
})
