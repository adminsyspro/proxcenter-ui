import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'

import { DISMISSED_STORAGE_KEY, useDismissedBroadcasts } from './useDismissedBroadcasts'

const banner = (id: string, updatedAt: string) => ({
  id,
  message: id,
  linkUrl: null,
  linkLabel: null,
  bgColor: '#f59e0b',
  fgColor: '#000000',
  dismissible: true,
  updatedAt,
})

beforeEach(() => {
  localStorage.clear()
})

afterEach(() => {
  cleanup()
})

describe('useDismissedBroadcasts', () => {
  it('shows every banner when nothing was dismissed', () => {
    const banners = [banner('a', '1'), banner('b', '1')]
    const { result } = renderHook(() => useDismissedBroadcasts(banners))
    expect(result.current.visible.map(b => b.id)).toEqual(['a', 'b'])
  })

  it('hides a dismissed banner and persists it', () => {
    const banners = [banner('a', '1'), banner('b', '1')]
    const { result } = renderHook(() => useDismissedBroadcasts(banners))
    act(() => result.current.dismiss(banners[0]))
    expect(result.current.visible.map(b => b.id)).toEqual(['b'])
    expect(JSON.parse(localStorage.getItem(DISMISSED_STORAGE_KEY)!)).toEqual({ a: '1' })
  })

  it('shows the banner again once the admin edits it', () => {
    localStorage.setItem(DISMISSED_STORAGE_KEY, JSON.stringify({ a: '1' }))
    const { result } = renderHook(() => useDismissedBroadcasts([banner('a', '2')]))
    expect(result.current.visible.map(b => b.id)).toEqual(['a'])
  })

  it('prunes entries for banners that no longer exist', () => {
    localStorage.setItem(DISMISSED_STORAGE_KEY, JSON.stringify({ a: '1', gone: '1' }))
    const { result } = renderHook(() => useDismissedBroadcasts([banner('a', '1')]))
    expect(result.current.visible).toEqual([])
    expect(JSON.parse(localStorage.getItem(DISMISSED_STORAGE_KEY)!)).toEqual({ a: '1' })
  })

  it('survives corrupted storage', () => {
    localStorage.setItem(DISMISSED_STORAGE_KEY, 'not json')
    const { result } = renderHook(() => useDismissedBroadcasts([banner('a', '1')]))
    expect(result.current.visible.map(b => b.id)).toEqual(['a'])
  })

  it('survives localStorage throwing', () => {
    const getItem = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied')
    })
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied')
    })
    const banners = [banner('a', '1')]
    const { result } = renderHook(() => useDismissedBroadcasts(banners))
    expect(result.current.visible.map(b => b.id)).toEqual(['a'])
    act(() => result.current.dismiss(banners[0]))
    expect(result.current.visible).toEqual([])
    getItem.mockRestore()
    setItem.mockRestore()
  })
})
