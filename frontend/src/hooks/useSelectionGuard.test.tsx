import { describe, it, expect, afterEach } from 'vitest'
import { renderHook, cleanup, act } from '@testing-library/react'

import { useSelectionGuard } from './useSelectionGuard'

afterEach(() => {
  cleanup()
})

describe('useSelectionGuard', () => {
  it('binds a request to the current selection until the selection changes', () => {
    const { result, rerender } = renderHook(({ k }) => useSelectionGuard(k), { initialProps: { k: 'A' as string | null } })

    const req = result.current.beginCurrent()

    expect(req.key).toBe('A')
    expect(req.isCurrent()).toBe(true)
    expect(req.signal.aborted).toBe(false)

    rerender({ k: 'B' })

    // The request of A is cancelled and its writes are refused.
    expect(req.signal.aborted).toBe(true)
    expect(req.isCurrent()).toBe(false)
    expect(result.current.beginCurrent().key).toBe('B')
  })

  it('gives a stale closure a request that is born aborted', () => {
    const { result, rerender } = renderHook(({ k }) => useSelectionGuard(k), { initialProps: { k: 'A' } })

    rerender({ k: 'B' })

    const late = result.current.begin('A')

    expect(late.signal.aborted).toBe(true)
    expect(late.isCurrent()).toBe(false)
    expect(result.current.begin('B').isCurrent()).toBe(true)
    expect(result.current.isCurrent('A')).toBe(false)
    expect(result.current.isCurrent('B')).toBe(true)
  })

  it('treats undefined and null as the same empty selection', () => {
    const { result } = renderHook(() => useSelectionGuard(undefined))

    expect(result.current.begin(null).isCurrent()).toBe(true)
    expect(result.current.isCurrent(undefined)).toBe(true)
  })

  it('starts a new generation when the user leaves a selection and comes back', () => {
    const { result, rerender } = renderHook(({ k }) => useSelectionGuard(k), { initialProps: { k: 'A' } })

    const first = result.current.begin('A')

    rerender({ k: 'B' })
    rerender({ k: 'A' })

    // Same key, but the request of the first visit stays detached.
    expect(first.isCurrent()).toBe(false)
    expect(result.current.begin('A').isCurrent()).toBe(true)
  })

  it('switchTo makes a key current before the render that shows it', () => {
    const { result, rerender } = renderHook(({ k }) => useSelectionGuard(k), { initialProps: { k: null as string | null } })

    const old = result.current.beginCurrent()
    let req!: ReturnType<typeof result.current.switchTo>

    act(() => { req = result.current.switchTo('X') })

    expect(old.signal.aborted).toBe(true)
    expect(req.isCurrent()).toBe(true)

    // The render catching up with the same key keeps the request alive.
    rerender({ k: 'X' })
    expect(req.isCurrent()).toBe(true)

    // Closing the dialog (key back to null) drops it.
    rerender({ k: null })
    expect(req.isCurrent()).toBe(false)
  })

  it('switchTo on the key already current keeps the running generation', () => {
    const { result } = renderHook(() => useSelectionGuard('A'))

    const before = result.current.beginCurrent()
    const again = result.current.switchTo('A')

    expect(before.isCurrent()).toBe(true)
    expect(again.signal).toBe(before.signal)
  })

  it('cancels everything on unmount', () => {
    const { result, unmount } = renderHook(() => useSelectionGuard('A'))

    const req = result.current.beginCurrent()

    unmount()
    expect(req.signal.aborted).toBe(true)
  })

  it('keeps a stable identity across renders', () => {
    const { result, rerender } = renderHook(({ k }) => useSelectionGuard(k), { initialProps: { k: 'A' } })
    const first = result.current

    rerender({ k: 'B' })
    expect(result.current).toBe(first)
  })
})
