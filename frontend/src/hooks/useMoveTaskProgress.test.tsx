import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, renderHook, waitFor } from '@testing-library/react'

import { MAX_POLLED_MOVES, useMoveTaskProgress, type MoveTaskRef } from './useMoveTaskProgress'

const move = (n: number, over: Partial<MoveTaskRef> = {}): MoveTaskRef => ({
  upid: `UPID:pve1:1:2:6A000000:qmmove:${100 + n}:root@pam:`,
  connectionId: 'conn-1',
  node: 'pve1',
  type: 'qmmove',
  status: 'running',
  ...over,
})

const HALF = { percent: 50, doneBytes: 512, totalBytes: 1024, bytesPerSec: 256, etaSec: 2 }

type TailAnswer = { total: number; finished: boolean; progress: typeof HALF | null }

let answers: Record<string, TailAnswer[]>
let fetchMock: ReturnType<typeof vi.fn>

const upidOf = (url: string) => decodeURIComponent(url.split('/')[6].split('?')[0])
const fromOf = (url: string) => new URL(`http://x${url}`).searchParams.get('from')

beforeEach(() => {
  answers = {}
  fetchMock = vi.fn(async (url: string) => {
    const queue = answers[upidOf(url)] || []
    const next = queue.length > 1 ? queue.shift()! : queue[0]
    if (!next) return new Response('{}', { status: 500 })
    return new Response(JSON.stringify(next))
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  // Unmount first: a hook left mounted keeps its polling rounds going.
  cleanup()
  vi.unstubAllGlobals()
})

describe('useMoveTaskProgress (roadmap#196)', () => {
  it('follows a running move from its log tail and passes back the line count it got', async () => {
    const a = move(1)
    answers[a.upid] = [
      { total: 12, finished: false, progress: HALF },
      { total: 14, finished: false, progress: { ...HALF, percent: 75 } },
    ]
    const { result } = renderHook(() => useMoveTaskProgress([a], 10))

    await waitFor(() => expect(result.current[a.upid]?.percent).toBe(75))
    const urls = fetchMock.mock.calls.map(c => String(c[0]))
    expect(urls[0]).toBe(`/api/v1/tasks/conn-1/pve1/${encodeURIComponent(a.upid)}?tail=1&from=0`)
    expect(fromOf(urls[1])).toBe('12')
  })

  it('keeps the last known progress when a poll brings no new progress line', async () => {
    const a = move(1)
    answers[a.upid] = [
      { total: 12, finished: false, progress: HALF },
      { total: 12, finished: false, progress: null },
    ]
    const { result } = renderHook(() => useMoveTaskProgress([a], 10))

    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(3))
    expect(result.current[a.upid]).toEqual(HALF)
  })

  it('asks nothing for tasks that are not running moves, nor when polling is off', async () => {
    const rows = [move(1, { type: 'qmigrate' }), move(2, { status: 'OK' })]
    renderHook(() => useMoveTaskProgress(rows, 10))
    const off = renderHook(() => useMoveTaskProgress([move(3)], 0))

    await new Promise(r => setTimeout(r, 40))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(off.result.current).toEqual({})
  })

  it('stops asking about a move whose log closed', async () => {
    const a = move(1)
    answers[a.upid] = [{ total: 20, finished: true, progress: { ...HALF, percent: 100 } }]
    const { result } = renderHook(() => useMoveTaskProgress([a], 10))

    await waitFor(() => expect(result.current[a.upid]?.percent).toBe(100))
    await new Promise(r => setTimeout(r, 50))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('follows at most MAX_POLLED_MOVES moves at once', async () => {
    const rows = Array.from({ length: MAX_POLLED_MOVES + 3 }, (_, i) => move(i))
    for (const r of rows) answers[r.upid] = [{ total: 1, finished: true, progress: HALF }]
    renderHook(() => useMoveTaskProgress(rows, 10))

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(MAX_POLLED_MOVES))
    await new Promise(r => setTimeout(r, 40))
    const asked = new Set(fetchMock.mock.calls.map(c => upidOf(String(c[0]))))
    expect(asked.size).toBe(MAX_POLLED_MOVES)
  })

  it('a failed poll is retried on the next round, without an entry meanwhile', async () => {
    const a = move(1)
    let calls = 0
    fetchMock.mockImplementation(async () => {
      calls++
      if (calls === 1) throw new Error('offline')
      return new Response(JSON.stringify({ total: 3, finished: false, progress: HALF }))
    })
    const { result } = renderHook(() => useMoveTaskProgress([a], 10))

    await waitFor(() => expect(result.current[a.upid]).toEqual(HALF))
    expect(calls).toBeGreaterThanOrEqual(2)
  })

  it('drops the progress of a move that left the list', async () => {
    const a = move(1)
    answers[a.upid] = [{ total: 3, finished: false, progress: HALF }]
    const { result, rerender } = renderHook(({ rows }) => useMoveTaskProgress(rows, 10), { initialProps: { rows: [a] } })

    await waitFor(() => expect(result.current[a.upid]).toEqual(HALF))
    rerender({ rows: [{ ...a, status: 'OK' }] })
    expect(result.current).toEqual({})
  })
})
