import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'

import { HOST_MAP_STORAGE_KEY, useHostMapView } from './useHostMapView'

const set = vi.fn()

beforeEach(() => {
  set.mockReset()
  window.localStorage.clear()
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('useHostMapView', () => {
  it('is null (automatic mode) with no URL choice and nothing stored', () => {
    const { result } = renderHook(() => useHostMapView({ map: null, set }))

    expect(result.current.view).toBeNull()
  })

  it('reads the choice remembered by this browser', () => {
    window.localStorage.setItem(HOST_MAP_STORAGE_KEY, 'dense')
    const { result } = renderHook(() => useHostMapView({ map: null, set }))

    expect(result.current.view).toBe('dense')
  })

  it('ignores a stored value that is not a view', () => {
    window.localStorage.setItem(HOST_MAP_STORAGE_KEY, 'huge')
    const { result } = renderHook(() => useHostMapView({ map: null, set }))

    expect(result.current.view).toBeNull()
  })

  it('the URL wins over the stored choice', () => {
    window.localStorage.setItem(HOST_MAP_STORAGE_KEY, 'dense')
    const { result } = renderHook(() => useHostMapView({ map: 'compact', set }))

    expect(result.current.view).toBe('compact')
  })

  it('choosing writes the URL and the browser memory', () => {
    const { result } = renderHook(() => useHostMapView({ map: null, set }))

    act(() => result.current.choose('compact'))
    expect(set).toHaveBeenCalledWith({ map: 'compact' })
    expect(window.localStorage.getItem(HOST_MAP_STORAGE_KEY)).toBe('compact')
    expect(result.current.view).toBe('compact')
  })

  it('works when localStorage throws: reads nothing, still writes the URL', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    const { result } = renderHook(() => useHostMapView({ map: null, set }))

    expect(result.current.view).toBeNull()
    act(() => result.current.choose('dense'))
    expect(set).toHaveBeenCalledWith({ map: 'dense' })
    expect(result.current.view).toBe('dense')
  })
})
