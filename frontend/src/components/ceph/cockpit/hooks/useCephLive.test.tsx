import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'

import { jsonRes, liveBody, setHidden } from './testHelpers'
import { useCephLive } from './useCephLive'

const mk = (n: number) => liveBody(n)
const fetchMock = vi.fn()

// Le fetcher du depot importe SWR, dont l'ecouteur de visibilite s'emballe sous faux timers (TimeoutNaNWarning).
vi.mock('@/hooks/useSWRFetch', () => ({ redirectToLoginOnce: vi.fn() }))

beforeEach(() => {
  vi.useFakeTimers()
  fetchMock.mockReset()
  fetchMock.mockImplementation(async () => jsonRes(mk(Date.now())))
  vi.stubGlobal('fetch', fetchMock)
  setHidden(false)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('useCephLive', () => {
  it('polls every 5s and pauses when hidden', async () => {
    renderHook(() => useCephLive('c1', true))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
    expect(fetchMock).toHaveBeenCalledTimes(3)

    act(() => setHidden(true))
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    expect(fetchMock).toHaveBeenCalledTimes(3)

    act(() => setHidden(false))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('a 200 without the live shape (demo fallback `[]`) is an error, never data', async () => {
    fetchMock.mockImplementation(async () => jsonRes([]))
    const { result } = renderHook(() => useCephLive('c1', true))

    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(result.current.live).toBeNull()
    expect(result.current.error?.name).toBe('CockpitShapeError')
    expect(result.current.absent).toBe(false)
  })

  it('refresh reads at once and resumes the polling after a 404', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 404, json: async () => ({ hasCeph: false }) })
    const { result } = renderHook(() => useCephLive('c1', true))

    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(result.current.absent).toBe(true)
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000) })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await act(async () => { result.current.refresh(); await vi.advanceTimersByTimeAsync(0) })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.current.absent).toBe(false)
    expect(result.current.live?.health.status).toBe('HEALTH_OK')
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('does not fetch when disabled or without connection', async () => {
    renderHook(() => useCephLive(null, true))
    renderHook(() => useCephLive('c1', false))
    await act(async () => { await vi.advanceTimersByTimeAsync(20_000) })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('buffer caps at 720 and resets on conn switch', async () => {
    const { result, rerender } = renderHook(({ c }) => useCephLive(c, true), { initialProps: { c: 'A' } })

    await act(async () => { await vi.advanceTimersByTimeAsync(5000 * 730) })
    expect(result.current.buffer).toHaveLength(720)

    rerender({ c: 'B' })
    expect(result.current.buffer).toHaveLength(0)
    expect(result.current.live).toBeNull()

    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(result.current.buffer).toHaveLength(1)
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(result.current.buffer).toHaveLength(2)
  })

  it('drops late response after conn switch', async () => {
    let resolveA: (v: unknown) => void = () => {}

    fetchMock.mockImplementationOnce(() => new Promise(r => { resolveA = r }))
    const { result, rerender } = renderHook(({ c }) => useCephLive(c, true), { initialProps: { c: 'A' } })

    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    fetchMock.mockImplementation(async () => jsonRes(liveBody(222, 'HEALTH_WARN')))
    rerender({ c: 'B' })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect((result.current.live as any).at).toBe(222)

    await act(async () => { resolveA(jsonRes(liveBody(111))); await vi.advanceTimersByTimeAsync(0) })
    expect((result.current.live as any).at).toBe(222)
    expect(result.current.buffer).toHaveLength(1)
  })

  it('keeps last data on error', async () => {
    const { result } = renderHook(() => useCephLive('c1', true))

    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    const first = result.current.live

    expect(first).not.toBeNull()
    expect(result.current.stale).toBe(false)

    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(result.current.stale).toBe(true)
    expect(result.current.live).toBe(first)
    expect(result.current.error).not.toBeNull()
    expect(result.current.lastOkAt).not.toBeNull()
  })

  it('does not double a request still in flight', async () => {
    let resolve: (v: unknown) => void = () => {}

    fetchMock.mockImplementation(() => new Promise(r => { resolve = r }))
    const { rerender } = renderHook(({ v }) => useCephLive('c1', v), { initialProps: { v: true } })

    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    // l'effet repart (enabled bascule) pendant que la requete est en vol : pas de second appel
    rerender({ v: false })
    rerender({ v: true })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await act(async () => { resolve(jsonRes(mk(1))); await vi.advanceTimersByTimeAsync(0) })
  })

  it('times out a hanging request after 10s and goes stale', async () => {
    const { result } = renderHook(() => useCephLive('c1', true))

    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(result.current.live).not.toBeNull()

    fetchMock.mockImplementation((_u: string, init: RequestInit) => new Promise((_r, rej) => {
      init.signal?.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError')))
    }))
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(result.current.stale).toBe(false)
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
    expect(result.current.stale).toBe(true)
    expect(result.current.live).not.toBeNull()
  })

  it('stops polling on 404 and exposes absent', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404, json: async () => ({ hasCeph: false }) })
    const { result } = renderHook(() => useCephLive('c1', true))

    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(result.current.absent).toBe(true)
    expect(result.current.error).toBeNull()
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('exposes the last poll as it is, with no memory of the checks of the earlier ones', async () => {
    const check = (name: string) => ({ name, severity: 'HEALTH_WARN', summary: name, detail: [] })
    const bodies = [[check('MON_DISK_LOW')], [], [check('MON_DISK_CRIT')]]
    let i = 0

    fetchMock.mockImplementation(async () => jsonRes({ ...mk(Date.now()), health: { status: 'HEALTH_WARN', checks: bodies[Math.min(i++, 2)] } }))
    const { result } = renderHook(() => useCephLive('c1', true))

    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(result.current.live?.health.checks.map(c => c.name)).toEqual(['MON_DISK_LOW'])
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(result.current.live?.health.checks).toEqual([])
    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(result.current.live?.health.checks.map(c => c.name)).toEqual(['MON_DISK_CRIT'])
  })
})
