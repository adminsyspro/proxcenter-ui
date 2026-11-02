import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, renderHook } from '@testing-library/react'

import { swrWrapper } from './testUtils'
import { useCephCrush } from './useCephCrush'

const fetchMock = vi.fn()
const flush = (ms = 0) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })

beforeEach(() => {
  vi.useFakeTimers()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('SWR retry policy of the cockpit', () => {
  it('never retries a 404', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 404, json: async () => ({}) })
    renderHook(() => useCephCrush('c1', true), { wrapper: swrWrapper })
    await flush(10 * 60_000)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('retries a 500, but a bounded number of times', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })
    renderHook(() => useCephCrush('c1', true), { wrapper: swrWrapper })
    await flush(10 * 60_000)
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1)
    expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(4)
  })

  it('does not retry in the background while the tab is hidden', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    try {
      renderHook(() => useCephCrush('c1', true), { wrapper: swrWrapper })
      await flush(10 * 60_000)
      expect(fetchMock).toHaveBeenCalledTimes(1)
    } finally {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
    }
  })
})
