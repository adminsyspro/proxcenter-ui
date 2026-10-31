// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useAlertIncidents } from './useAlertIncidents'

const { swrMock } = vi.hoisted(() => ({ swrMock: vi.fn() }))

vi.mock('swr', () => ({ default: (key: string | null, fetcher: unknown) => swrMock(key, fetcher) }))

const fetchMock = vi.fn()

beforeEach(() => {
  swrMock.mockReset().mockReturnValue({ data: { incidents: { a: { id: 'i1', title: 'T', status: 'open', comment_count: 0 } } } })
  fetchMock.mockReset().mockImplementation(async (url: string) => {
    const ids = url.split('ids=')[1].split(',')

    return { ok: true, status: 200, text: async () => JSON.stringify({ incidents: Object.fromEntries(ids.map(id => [id, { id: `i-${id}` }])) }) }
  })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => vi.unstubAllGlobals())

describe('useAlertIncidents', () => {
  it('returns the map of the incidents', () => {
    const { result } = renderHook(() => useAlertIncidents(['a', 'b'], true))

    expect(swrMock.mock.calls[0][0]).toBe('/api/v1/incidents/by-alerts?ids=a,b')
    expect(result.current.a.id).toBe('i1')
  })

  it('does not ask when disabled or without ids', () => {
    renderHook(() => useAlertIncidents(['a'], false))
    renderHook(() => useAlertIncidents([], true))

    expect(swrMock.mock.calls[0][0]).toBeNull()
    expect(swrMock.mock.calls[1][0]).toBeNull()
  })

  it('keeps the same key when the ids come in another order', () => {
    renderHook(() => useAlertIncidents(['c', 'a', 'b'], true))
    renderHook(() => useAlertIncidents(['b', 'c', 'a'], true))

    expect(swrMock.mock.calls[0][0]).toBe(swrMock.mock.calls[1][0])
  })

  it('splits more than 100 ids into calls of at most 100 and merges the results', async () => {
    const ids = Array.from({ length: 250 }, (_, i) => `a${String(i).padStart(3, '0')}`)

    renderHook(() => useAlertIncidents(ids, true))

    const [key, fetchBatches] = swrMock.mock.calls[0]
    const merged = await fetchBatches(key)

    expect(fetchMock).toHaveBeenCalledTimes(3)
    for (const [url] of fetchMock.mock.calls) {
      expect((url as string).split('ids=')[1].split(',').length).toBeLessThanOrEqual(100)
    }
    expect(Object.keys(merged.incidents)).toHaveLength(250)
  })
})
