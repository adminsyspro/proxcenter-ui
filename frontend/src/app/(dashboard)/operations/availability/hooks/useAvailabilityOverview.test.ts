// @vitest-environment jsdom

import { createElement, type ReactNode } from 'react'

import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useSWRFetch } from '@/hooks/useSWRFetch'

import { useAvailabilityOverview } from './useAvailabilityOverview'

vi.mock('@/hooks/useSWRFetch', async importOriginal => {
  const actual = await importOriginal<typeof import('@/hooks/useSWRFetch')>()

  return { ...actual, useSWRFetch: vi.fn(actual.useSWRFetch) }
})

const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(SWRConfig, { value: { provider: () => new Map(), dedupingInterval: 0 } }, children)

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('useAvailabilityOverview', () => {
  it('reads the overview of the period and refreshes every 30 s', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ period: '7d', connections: [] }), { status: 200 }))

    const { result } = renderHook(() => useAvailabilityOverview('7d'), { wrapper })

    await waitFor(() => expect(result.current.data).toEqual({ period: '7d', connections: [] }))

    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/availability/overview?period=7d')
    expect(vi.mocked(useSWRFetch)).toHaveBeenCalledWith(
      '/api/v1/availability/overview?period=7d',
      expect.objectContaining({ refreshInterval: 30000 }),
    )
  })

  it('exposes the failure of a 503 and no data', async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: 'orchestrator_unavailable' }), { status: 503 }))

    const { result } = renderHook(() => useAvailabilityOverview('24h'), { wrapper })

    await waitFor(() => expect(result.current.error).toBeTruthy())

    expect(result.current.data).toBeUndefined()
  })

  it('does not ask again after a 403', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })

    try {
      fetchMock.mockImplementation(async () => new Response(JSON.stringify({ error: 'feature_required' }), { status: 403 }))

      const { result } = renderHook(() => useAvailabilityOverview('7d'), { wrapper })

      await waitFor(() => expect(result.current.error).toBeTruthy())

      const calls = fetchMock.mock.calls.length

      for (let tick = 0; tick < 5; tick++) await act(async () => { await vi.advanceTimersByTimeAsync(5000) })

      expect(fetchMock.mock.calls.length).toBe(calls)
    } finally {
      vi.useRealTimers()
    }
  })
})
