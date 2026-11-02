import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, renderHook } from '@testing-library/react'

import { useRevalidateErrorOnResume } from './useRevalidateErrorOnResume'

let tabVisible = true

vi.mock('@/hooks/usePageVisibility', () => ({ usePageVisible: () => tabVisible }))

beforeEach(() => {
  tabVisible = true
})

afterEach(cleanup)

describe('useRevalidateErrorOnResume', () => {
  it('revalidates once when the tab becomes visible again with an error', () => {
    const revalidate = vi.fn()
    const { rerender } = renderHook(() => useRevalidateErrorOnResume(new Error('boom'), revalidate))

    expect(revalidate).not.toHaveBeenCalled()
    tabVisible = false
    rerender()
    expect(revalidate).not.toHaveBeenCalled()
    tabVisible = true
    rerender()
    rerender()
    expect(revalidate).toHaveBeenCalledTimes(1)
  })

  it('makes no call on resume without an error', () => {
    const revalidate = vi.fn()
    const { rerender } = renderHook(() => useRevalidateErrorOnResume(undefined, revalidate))

    tabVisible = false
    rerender()
    tabVisible = true
    rerender()
    expect(revalidate).not.toHaveBeenCalled()
  })

  it('uses the error and the function of the latest render, not those of the hidden moment', () => {
    const first = vi.fn()
    const second = vi.fn()
    let error: unknown = new Error('boom')
    let revalidate = first
    const { rerender } = renderHook(() => useRevalidateErrorOnResume(error, revalidate))

    tabVisible = false
    rerender()
    revalidate = second
    rerender()
    tabVisible = true
    rerender()
    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledTimes(1)
    tabVisible = false
    error = undefined
    rerender()
    tabVisible = true
    rerender()
    expect(second).toHaveBeenCalledTimes(1)
  })
})
