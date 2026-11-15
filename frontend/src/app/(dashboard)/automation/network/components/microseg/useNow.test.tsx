import { act, cleanup, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { NOW_REFRESH_MS, useNow } from './useNow'

describe('useNow', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-02T10:00:00Z'))
  })
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('moves on every 30 s, not in between', () => {
    const start = Date.now()
    const { result } = renderHook(() => useNow())
    act(() => { vi.advanceTimersByTime(0) })
    expect(result.current).toBe(start)
    act(() => { vi.advanceTimersByTime(NOW_REFRESH_MS - 1) })
    expect(result.current).toBe(start)
    act(() => { vi.advanceTimersByTime(1) })
    expect(result.current).toBe(start + NOW_REFRESH_MS)
  })

  it('reads the clock again when its reset key changes', () => {
    const { result, rerender } = renderHook(({ key }) => useNow(NOW_REFRESH_MS, key), { initialProps: { key: 'a' } })
    const start = result.current
    vi.setSystemTime(start + 5_000)
    rerender({ key: 'b' })
    act(() => { vi.advanceTimersByTime(0) })
    expect(result.current).toBe(start + 5_000)
  })

  it('stops its timers on unmount', () => {
    const { unmount } = renderHook(() => useNow())
    expect(vi.getTimerCount()).toBe(2)
    unmount()
    expect(vi.getTimerCount()).toBe(0)
  })
})
