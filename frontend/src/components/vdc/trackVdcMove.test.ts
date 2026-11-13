import { afterEach, describe, expect, it, vi } from 'vitest'

import { moveToTaskUpdate, stopTracking, trackVdcMove } from './trackVdcMove'

const TEXTS = { copying: 'copy', finalizing: 'link', done: 'done', doneWithWarnings: 'done!' }

afterEach(() => { vi.useRealTimers() })

describe('moveToTaskUpdate', () => {
  it('maps every status', () => {
    expect(moveToTaskUpdate({ status: 'copying' }, TEXTS)).toEqual({ status: 'running', progress: 40, detail: 'copy' })
    expect(moveToTaskUpdate({ status: 'finalizing' }, TEXTS)).toEqual({ status: 'running', progress: 90, detail: 'link' })
    expect(moveToTaskUpdate({ status: 'done', warnings: [] }, TEXTS)).toEqual({ status: 'done', progress: 100, detail: 'done' })
    expect(moveToTaskUpdate({ status: 'done', warnings: [{}] }, TEXTS)).toEqual({ status: 'done', progress: 100, detail: 'done!' })
    expect(moveToTaskUpdate({ status: 'failed', error: 'boom' }, TEXTS)).toEqual({ status: 'error', progress: 100, error: 'boom' })
  })
})

describe('trackVdcMove', () => {
  it('polls until the move ends, once per move', async () => {
    vi.useFakeTimers()
    const statuses = ['copying', 'done']
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ data: { status: statuses.shift() ?? 'done' } }) })) as any
    const onUpdate = vi.fn()

    trackVdcMove('m1', onUpdate, TEXTS, fetchImpl)
    trackVdcMove('m1', onUpdate, TEXTS, fetchImpl)
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(5_000)
    expect(onUpdate).toHaveBeenLastCalledWith({ status: 'done', progress: 100, detail: 'done' })
    await vi.advanceTimersByTimeAsync(20_000)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('ignores a failed poll and can be stopped', async () => {
    vi.useFakeTimers()
    const fetchImpl = vi.fn(async () => ({ ok: false })) as any
    const onUpdate = vi.fn()
    trackVdcMove('m2', onUpdate, TEXTS, fetchImpl)
    await vi.advanceTimersByTimeAsync(5_000)
    stopTracking('m2')
    await vi.advanceTimersByTimeAsync(20_000)
    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(onUpdate).not.toHaveBeenCalled()
  })
})
