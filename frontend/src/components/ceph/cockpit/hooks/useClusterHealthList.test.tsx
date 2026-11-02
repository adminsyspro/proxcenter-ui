import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'

import { jsonRes, liveBody, swrWrapper } from './testUtils'
import { useClusterHealthList, useRefreshClusterHealthList } from './useClusterHealthList'

const fetchMock = vi.fn()

beforeEach(() => {
  vi.useFakeTimers()
  fetchMock.mockReset()
  fetchMock.mockImplementation(async (url: string) =>
    url.includes('bad') ? { ok: false, status: 500, json: async () => ({}) }
      : url.includes('none') ? { ok: false, status: 404, json: async () => ({ hasCeph: false }) } : jsonRes(liveBody(0, 'HEALTH_WARN')))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('useClusterHealthList', () => {
  it('calls once per connection and never again', async () => {
    const { result } = renderHook(() => useClusterHealthList(['a', 'bad', 'none']), { wrapper: swrWrapper })

    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(result.current).toEqual({
      a: { status: 'HEALTH_WARN', error: false, absent: false },
      bad: { status: null, error: true, absent: false },
      none: { status: null, error: false, absent: true },
    })

    await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60_000) })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('404 is absent, not an error', async () => {
    const { result } = renderHook(() => useClusterHealthList(['none']), { wrapper: swrWrapper })

    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(result.current.none).toEqual({ status: null, error: false, absent: true })
  })

  it('500 is an error, not absent', async () => {
    const { result } = renderHook(() => useClusterHealthList(['bad']), { wrapper: swrWrapper })

    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(result.current.bad).toEqual({ status: null, error: true, absent: false })
  })

  it('a 200 without health is an error, not a crash', async () => {
    fetchMock.mockImplementation(async () => jsonRes([]))
    const { result } = renderHook(() => useClusterHealthList(['odd']), { wrapper: swrWrapper })

    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(result.current.odd).toEqual({ status: null, error: true, absent: false })
  })

  it('refresh reads every dot again', async () => {
    const { result } = renderHook(() => ({ list: useClusterHealthList(['a', 'b']), refresh: useRefreshClusterHealthList() }), { wrapper: swrWrapper })

    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await act(async () => { result.current.refresh(); await vi.advanceTimersByTimeAsync(0) })
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('does nothing without connections', async () => {
    renderHook(() => useClusterHealthList([]), { wrapper: swrWrapper })
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
