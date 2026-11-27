import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { useK8sResource } from './useK8sResource'

const fetchSpy = vi.fn()

beforeEach(() => {
  vi.stubGlobal('fetch', fetchSpy)
  Object.defineProperty(document, 'hidden', { configurable: true, value: false })
  fetchSpy.mockReset()
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function jsonRes(body: any, status = 200) {
  return Promise.resolve({ ok: status < 400, status, json: () => Promise.resolve(body) } as Response)
}

// Drain all resolved promises in the microtask queue
function flushPromises() {
  return act(async () => { await new Promise<void>(r => setTimeout(r, 0)) })
}

describe('useK8sResource', () => {
  it('loads items (empty distinguished from error)', async () => {
    fetchSpy.mockReturnValue(jsonRes({ items: [], truncated: false }))
    const { result } = renderHook(() => useK8sResource('c1', 'pod', 'demo', { pollMs: 0 }))
    await waitFor(() => expect(result.current.status).toBe('ok'))
    expect(result.current.items).toEqual([])
  })

  it('marks forbidden when envelope errorCode=forbidden', async () => {
    fetchSpy.mockReturnValue(jsonRes({ items: [], truncated: false, errorCode: 'forbidden', errorMessage: 'no access' }))
    const { result } = renderHook(() => useK8sResource('c1', 'pod', 'demo', { pollMs: 0 }))
    await waitFor(() => expect(result.current.status).toBe('forbidden'))
    expect(result.current.errorMessage).toBe('no access')
  })

  it('marks error on non-2xx, keeps items distinct from empty', async () => {
    fetchSpy.mockReturnValue(jsonRes({ error: 'down' }, 502))
    const { result } = renderHook(() => useK8sResource('c1', 'pod', 'demo', { pollMs: 0 }))
    await waitFor(() => expect(result.current.status).toBe('error'))
  })

  it('does not fetch when kind is null', async () => {
    renderHook(() => useK8sResource('c1', null, undefined, { pollMs: 0 }))
    await new Promise(r => setTimeout(r, 10))
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('sets loading status initially then ok', async () => {
    let resolveRes!: (v: Response) => void
    fetchSpy.mockReturnValue(new Promise<Response>(res => { resolveRes = res }))
    const { result } = renderHook(() => useK8sResource('c1', 'pod', 'demo', { pollMs: 0 }))
    expect(result.current.status).toBe('loading')
    await act(async () => {
      resolveRes({ ok: true, status: 200, json: () => Promise.resolve({ items: [{ name: 'a', namespace: '', uid: '1', createdAt: '', ready: true, status: '' }], truncated: false }) } as Response)
    })
    await waitFor(() => expect(result.current.status).toBe('ok'))
    expect(result.current.items).toHaveLength(1)
  })

  it('refresh() triggers an immediate re-fetch', async () => {
    fetchSpy.mockReturnValue(jsonRes({ items: [], truncated: false }))
    const { result } = renderHook(() => useK8sResource('c1', 'pod', 'demo', { pollMs: 0 }))
    await waitFor(() => expect(result.current.status).toBe('ok'))
    const callsBefore = fetchSpy.mock.calls.length
    await act(async () => { result.current.refresh() })
    await waitFor(() => expect(fetchSpy.mock.calls.length).toBeGreaterThan(callsBefore))
  })

  it('polling fires after pollMs (fake timers)', async () => {
    vi.useFakeTimers()
    fetchSpy.mockReturnValue(jsonRes({ items: [], truncated: false }))
    const { result } = renderHook(() => useK8sResource('c1', 'pod', 'demo', { pollMs: 5000 }))
    // Drain initial fetch
    await act(async () => { await vi.advanceTimersByTimeAsync(50) })
    expect(result.current.status).toBe('ok')
    const callsAfterInit = fetchSpy.mock.calls.length
    // Advance past poll interval
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(fetchSpy.mock.calls.length).toBeGreaterThan(callsAfterInit)
  })

  it('stops polling when forbidden status returned', async () => {
    vi.useFakeTimers()
    fetchSpy.mockReturnValue(jsonRes({ items: [], truncated: false, errorCode: 'forbidden', errorMessage: 'no access' }))
    const { result } = renderHook(() => useK8sResource('c1', 'pod', 'demo', { pollMs: 5000 }))
    // Drain initial fetch
    await act(async () => { await vi.advanceTimersByTimeAsync(50) })
    expect(result.current.status).toBe('forbidden')
    const callsAfterForbidden = fetchSpy.mock.calls.length
    // Advance well past poll interval - no additional fetches
    await act(async () => { await vi.advanceTimersByTimeAsync(15000) })
    expect(fetchSpy.mock.calls.length).toBe(callsAfterForbidden)
  })

  it('aborts in-flight request on unmount', async () => {
    const abortSpy = vi.fn()
    const OriginalAbortController = globalThis.AbortController
    class MockAbortController {
      signal = { aborted: false } as AbortSignal
      abort = abortSpy
    }
    vi.stubGlobal('AbortController', MockAbortController)
    fetchSpy.mockReturnValue(new Promise(() => {})) // never resolves
    const { unmount } = renderHook(() => useK8sResource('c1', 'pod', 'demo', { pollMs: 0 }))
    unmount()
    expect(abortSpy).toHaveBeenCalled()
    vi.stubGlobal('AbortController', OriginalAbortController)
  })

  it('pauses polling when opts.paused is true', async () => {
    vi.useFakeTimers()
    fetchSpy.mockReturnValue(jsonRes({ items: [], truncated: false }))
    renderHook(() => useK8sResource('c1', 'pod', 'demo', { pollMs: 5000, paused: true }))
    // Drain anything that might run
    await act(async () => { await vi.advanceTimersByTimeAsync(50) })
    expect(fetchSpy).not.toHaveBeenCalled()
    // Advance past poll interval - still paused
    await act(async () => { await vi.advanceTimersByTimeAsync(10000) })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('stops polling after 3 repeated errors (backoff)', async () => {
    vi.useFakeTimers()
    fetchSpy.mockReturnValue(jsonRes({ error: 'server down' }, 500))
    const { result } = renderHook(() => useK8sResource('c1', 'pod', 'demo', { pollMs: 1000 }))
    // Initial fetch: errorStreak=1
    await act(async () => { await vi.advanceTimersByTimeAsync(50) })
    expect(result.current.status).toBe('error')
    // Tick 2: errorStreak=2
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    // Tick 3: errorStreak=3
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    const callsAt3 = fetchSpy.mock.calls.length
    expect(callsAt3).toBeGreaterThanOrEqual(3)
    // Further ticks: backed off (errorStreak >= 3, no more fetches)
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(fetchSpy.mock.calls.length).toBe(callsAt3)
  })

  it('stale response resolved after abort does NOT overwrite state (race guard)', async () => {
    // Simulate: a slow fetch resolves AFTER its AbortController is aborted.
    // Without the `ac.signal.aborted` guard the stale result would be applied.
    let resolveStale!: (v: Response) => void
    const stalePromise = new Promise<Response>(res => { resolveStale = res })

    // First call returns the deferred (stale) promise; second call returns success.
    fetchSpy
      .mockReturnValueOnce(stalePromise)
      .mockReturnValue(jsonRes({ items: [{ name: 'fresh', namespace: '', uid: '2', createdAt: '', ready: true, status: '' }], truncated: false }))

    const { result } = renderHook(() => useK8sResource('c1', 'pod', 'demo', { pollMs: 0 }))

    // First fetch is in-flight (stale). Trigger refresh() which aborts the first
    // AbortController and starts a fresh load().
    await act(async () => { result.current.refresh() })

    // Now resolve the stale (aborted) fetch with a success body that has different items.
    await act(async () => {
      resolveStale({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ items: [{ name: 'stale', namespace: '', uid: '1', createdAt: '', ready: true, status: '' }], truncated: false }),
      } as Response)
    })

    // Drain microtasks so both promises have settled.
    await flushPromises()

    // The fresh fetch should have made status 'ok'.
    await waitFor(() => expect(result.current.status).toBe('ok'))

    // The stale item ('stale') must NOT appear; guard prevented it from being applied.
    const names = result.current.items.map(i => i.name)
    expect(names).not.toContain('stale')
    expect(names).toContain('fresh')
  })

  it('refresh() recovers from backoff: resets errorStreak so polling resumes', async () => {
    vi.useFakeTimers()
    // First 3 calls fail (errorStreak reaches 3 = backoff)
    fetchSpy
      .mockReturnValueOnce(jsonRes({ error: 'down' }, 500))
      .mockReturnValueOnce(jsonRes({ error: 'down' }, 500))
      .mockReturnValueOnce(jsonRes({ error: 'down' }, 500))
      // recovery via refresh() succeeds
      .mockReturnValue(jsonRes({ items: [], truncated: false }))

    const { result } = renderHook(() => useK8sResource('c1', 'pod', 'demo', { pollMs: 1000 }))

    // Drive through 3 failing fetches
    await act(async () => { await vi.advanceTimersByTimeAsync(50) })   // initial
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) }) // tick 2
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) }) // tick 3
    expect(result.current.status).toBe('error')

    const callsAtBackoff = fetchSpy.mock.calls.length
    // Polling is stopped (errorStreak >= 3)
    await act(async () => { await vi.advanceTimersByTimeAsync(3000) })
    expect(fetchSpy.mock.calls.length).toBe(callsAtBackoff)

    // refresh() is the recovery path; it bypasses the errorStreak guard
    await act(async () => { result.current.refresh() })
    await act(async () => { await vi.advanceTimersByTimeAsync(50) })
    expect(result.current.status).toBe('ok') // recovery succeeded

    // After a successful response errorStreak is reset to 0, so polling resumes
    const callsAfterRecovery = fetchSpy.mock.calls.length
    await act(async () => { await vi.advanceTimersByTimeAsync(1000) })
    expect(fetchSpy.mock.calls.length).toBeGreaterThan(callsAfterRecovery)
  })
})
