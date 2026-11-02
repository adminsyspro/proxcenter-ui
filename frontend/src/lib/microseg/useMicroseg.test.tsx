import React, { type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'

import { useMicrosegPolicy, useMicrosegRun } from './useMicroseg'

const fetchMock = vi.fn()
const reply = (status: number, body: unknown) => ({ ok: status < 400, status, text: async () => JSON.stringify(body) })
const run = (status: string, id = 'r1') => reply(200, { id, kind: 'plan', status, result: null })
const urls = () => fetchMock.mock.calls.map(c => c[0] as string)

const wrapper = ({ children }: { children: ReactNode }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>
)

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('useMicrosegRun', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  it('polls a run every 2 s until done', async () => {
    fetchMock
      .mockResolvedValueOnce(run('running'))
      .mockResolvedValueOnce(run('running'))
      .mockResolvedValueOnce(run('done'))
    const { result } = renderHook(() => useMicrosegRun('c1', 'r1'))

    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.current.done).toBe(false)
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(result.current.done).toBe(true)
    expect(result.current.run?.status).toBe('done')

    await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(urls()[0]).toBe('/api/v1/firewall/microseg/c1/runs/r1')
  })

  it('stops on failed', async () => {
    fetchMock.mockResolvedValueOnce(run('failed'))
    const { result } = renderHook(() => useMicrosegRun('c1', 'r1'))
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.current.done).toBe(true)
  })

  it('stops polling when the connection changes, and follows the new one', async () => {
    fetchMock.mockImplementation(async (url: string) => run('running', url))
    const { rerender } = renderHook(({ c }) => useMicrosegRun(c, 'r1'), { initialProps: { c: 'c1' } })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(urls()).toEqual(['/api/v1/firewall/microseg/c1/runs/r1'])

    rerender({ c: 'c2' })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    fetchMock.mockClear()
    await act(async () => { await vi.advanceTimersByTimeAsync(6000) })
    expect(urls().length).toBeGreaterThan(0)
    expect(urls().every(u => u.includes('/c2/'))).toBe(true)
  })

  it('stops polling on unmount and when the run id is cleared', async () => {
    fetchMock.mockResolvedValue(run('running'))
    const { unmount } = renderHook(() => useMicrosegRun('c1', 'r1'))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    unmount()
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    fetchMock.mockClear()
    const { result, rerender } = renderHook(({ id }) => useMicrosegRun('c1', id), { initialProps: { id: 'r1' as string | null } })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    rerender({ id: null })
    expect(result.current.run).toBeNull()
    fetchMock.mockClear()
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('drops an answer that arrives after the connection changed', async () => {
    let release: (v: unknown) => void = () => {}
    fetchMock.mockImplementationOnce(() => new Promise(r => { release = r }))
    fetchMock.mockResolvedValue(run('done', 'r2'))
    const { result, rerender } = renderHook(({ c }) => useMicrosegRun(c, 'r1'), { initialProps: { c: 'c1' } })
    rerender({ c: 'c2' })
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    await act(async () => { release(run('running', 'old')); await vi.advanceTimersByTimeAsync(0) })
    expect(result.current.run?.id).toBe('r2')
  })

  it('keeps polling after a transient error but gives up on NOT_FOUND', async () => {
    fetchMock
      .mockResolvedValueOnce(reply(502, { code: 'ORCHESTRATOR_ERROR', error: 'x' }))
      .mockResolvedValueOnce(run('running'))
      .mockResolvedValueOnce(reply(404, { code: 'NOT_FOUND', error: 'gone' }))
    const { result } = renderHook(() => useMicrosegRun('c1', 'r1'))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(result.current.error).toMatchObject({ code: 'ORCHESTRATOR_ERROR' })
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    expect(result.current.run?.status).toBe('running')
    expect(result.current.error).toBeNull()
    await act(async () => { await vi.advanceTimersByTimeAsync(2000) })
    expect(result.current.error).toMatchObject({ code: 'NOT_FOUND' })
    await act(async () => { await vi.advanceTimersByTimeAsync(10_000) })
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })
})

describe('useMicrosegPolicy', () => {
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })

  const policy = { policy: { id: 'p' }, zones: [], flows: [], pending_members: [], last_revision: null, version: 2, pending_changes: false }

  it('loads the draft, exposes the error and reloads', async () => {
    fetchMock.mockResolvedValue(reply(200, policy))
    const { result } = renderHook(() => useMicrosegPolicy('c1'), { wrapper })
    expect(result.current.loading).toBe(true)
    await waitFor(() => expect(result.current.data?.version).toBe(2))
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/firewall/microseg/c1/policy')

    fetchMock.mockResolvedValue(reply(200, { ...policy, version: 3 }))
    await act(() => result.current.reload())
    expect(result.current.data?.version).toBe(3)
  })

  it('retries a transient error but not a fatal one', async () => {
    vi.useFakeTimers()
    try {
      fetchMock.mockResolvedValue(reply(502, { code: 'ORCHESTRATOR_ERROR', error: 'x' }))
      const transient = renderHook(() => useMicrosegPolicy('c1'), { wrapper })
      await act(async () => { await vi.advanceTimersByTimeAsync(0) })
      expect(fetchMock).toHaveBeenCalledTimes(1)
      await act(async () => { await vi.advanceTimersByTimeAsync(20_000) })
      expect(fetchMock.mock.calls.length).toBeGreaterThan(1)
      transient.unmount()

      fetchMock.mockReset()
      fetchMock.mockResolvedValue(reply(403, { code: 'FEATURE_REQUIRED', error: 'licence' }))
      renderHook(() => useMicrosegPolicy('c2'), { wrapper })
      await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
      expect(fetchMock).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
  })

  it('surfaces a MicrosegApiError and does not fetch without a connection', async () => {
    fetchMock.mockResolvedValue(reply(403, { code: 'FEATURE_REQUIRED', error: 'licence' }))
    const { result } = renderHook(() => useMicrosegPolicy('c1'), { wrapper })
    await waitFor(() => expect(result.current.error).toBeTruthy())
    expect(result.current.error).toMatchObject({ code: 'FEATURE_REQUIRED', status: 403 })

    fetchMock.mockClear()
    const none = renderHook(() => useMicrosegPolicy(null), { wrapper })
    expect(none.result.current.data).toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
