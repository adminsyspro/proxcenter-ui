/**
 * Recette D1: a finished run refreshes what it changed ONCE. The Firewalling zone tools used to hand RunStrip new
 * callbacks on every render; RunLine's effect depended on them, so a finished run reloaded, re-rendered and reloaded
 * again without end ("Maximum update depth exceeded", /policy read hundreds of times).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup } from '@testing-library/react'

import { renderWithProviders } from '@/__tests__/setup/renderWithProviders'

vi.mock('@/lib/microseg/useMicroseg', () => ({
  useMicrosegRun: () => ({ run: { status: 'done', result: { done: [], failed: [], not_run: [] } }, done: true, error: null }),
}))

import RunStrip from '../microseg/RunStrip'

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('RunStrip with callbacks that change on every render', () => {
  it('calls onFinished once per run, whatever the re-renders, and removes the line after its linger', () => {
    vi.useFakeTimers()
    const onFinished = vi.fn()
    const removed = vi.fn()
    const runs = [{ runId: 'r1', kind: 'apply', label: 'Plan', runningText: 'running' }]
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {})
    const view = renderWithProviders(<RunStrip connectionId='c1' runs={runs} onFinished={() => onFinished()} onRemove={id => removed(id)} />)
    // 50 renders with new inline callbacks, over a second of timers.
    for (let i = 0; i < 50; i++) {
      view.rerender(<RunStrip connectionId='c1' runs={runs} onFinished={() => onFinished()} onRemove={id => removed(id)} />)
      act(() => { vi.advanceTimersByTime(20) })
    }
    expect(onFinished).toHaveBeenCalledTimes(1)
    expect(removed).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(10_000) })
    expect(removed).toHaveBeenCalledTimes(1)
    expect(errors.mock.calls.filter(c => /Maximum update depth|not wrapped in act/.test(String(c[0])))).toEqual([])
    errors.mockRestore()
  })
})
