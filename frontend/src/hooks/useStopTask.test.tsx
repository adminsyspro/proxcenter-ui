/**
 * #974: a stop offered on a task row is destructive and often lands on work
 * somebody else started, so the ask/confirm dance, the busy flag and the
 * "already asked" bookkeeping are pinned here rather than in three surfaces.
 */
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'

import { useStopTask } from './useStopTask'

const target = (over: Record<string, any> = {}) => ({
  id: 'row-1',
  run: vi.fn(async () => ({ ok: true })),
  ...over,
})

describe('useStopTask', () => {
  it('fires nothing until the confirmation is given', async () => {
    const stop = target()
    const { result } = renderHook(() => useStopTask())

    act(() => { result.current.ask(stop) })
    expect(result.current.target).toBe(stop)
    expect(stop.run).not.toHaveBeenCalled()

    await act(async () => { await result.current.confirm() })
    expect(stop.run).toHaveBeenCalledTimes(1)
  })

  it('drops the request and calls nothing when it is dismissed', async () => {
    const stop = target()
    const { result } = renderHook(() => useStopTask())

    act(() => { result.current.ask(stop) })
    act(() => { result.current.dismiss() })

    expect(result.current.target).toBeNull()
    expect(stop.run).not.toHaveBeenCalled()
  })

  it('refreshes the lists and disables the row once the stop is acknowledged', async () => {
    const onStopped = vi.fn()
    const stop = target()
    const { result } = renderHook(() => useStopTask(onStopped))

    act(() => { result.current.ask(stop) })
    await act(async () => { await result.current.confirm() })

    expect(onStopped).toHaveBeenCalledTimes(1)
    expect(result.current.isStopping('row-1')).toBe(true)
    expect(result.current.target).toBeNull()
    expect(result.current.error).toBeNull()
  })

  // A 403 (no node.manage / vm.migrate) and a 400 on a task that just finished
  // both land here: a silent no-op on click is what #767 already reported once.
  it('surfaces a refusal and leaves the row clickable', async () => {
    const onStopped = vi.fn()
    const stop = target({ run: vi.fn(async () => ({ ok: false, error: 'Permission denied' })) })
    const { result } = renderHook(() => useStopTask(onStopped))

    act(() => { result.current.ask(stop) })
    await act(async () => { await result.current.confirm() })

    expect(result.current.error).toBe('Permission denied')
    expect(result.current.isStopping('row-1')).toBe(false)
    expect(onStopped).not.toHaveBeenCalled()

    act(() => { result.current.clearError() })
    expect(result.current.error).toBeNull()
  })

  it('clears a previous error when a new row is asked about', async () => {
    const { result } = renderHook(() => useStopTask())

    act(() => { result.current.ask(target({ run: vi.fn(async () => ({ ok: false, error: 'boom' })) })) })
    await act(async () => { await result.current.confirm() })
    expect(result.current.error).toBe('boom')

    act(() => { result.current.ask(target({ id: 'row-2' })) })
    expect(result.current.error).toBeNull()
  })
})
