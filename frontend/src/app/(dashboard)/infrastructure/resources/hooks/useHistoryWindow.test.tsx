import { describe, it, expect, afterEach, vi } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'

import { HISTORY_WINDOW_STORAGE_KEY, useHistoryWindow } from './useHistoryWindow'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  localStorage.clear()
})

describe('useHistoryWindow', () => {
  it('defaults to 180 days and remembers the choice', () => {
    const { result } = renderHook(() => useHistoryWindow())

    expect(result.current[0]).toBe(180)

    act(() => result.current[1](365))

    expect(result.current[0]).toBe(365)
    expect(localStorage.getItem(HISTORY_WINDOW_STORAGE_KEY)).toBe('365')
  })

  it('restores a saved window and ignores a value it does not offer', () => {
    localStorage.setItem(HISTORY_WINDOW_STORAGE_KEY, '90')
    expect(renderHook(() => useHistoryWindow()).result.current[0]).toBe(90)

    localStorage.setItem(HISTORY_WINDOW_STORAGE_KEY, '42')
    expect(renderHook(() => useHistoryWindow()).result.current[0]).toBe(180)
  })

  it('keeps working when the storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })

    const { result } = renderHook(() => useHistoryWindow())

    expect(result.current[0]).toBe(180)

    act(() => result.current[1](90))

    expect(result.current[0]).toBe(90)
  })
})
