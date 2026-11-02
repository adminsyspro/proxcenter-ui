import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, renderHook, waitFor } from '@testing-library/react'

import { jsonRes, swrWrapper } from './testUtils'
import { useCephCrush } from './useCephCrush'

const fetchMock = vi.fn()
let tabVisible = true

// SWR ecoute visibilitychange avec un setTimeout.bind qui recoit l'evenement comme delai : visibilite pilotee par mock.
vi.mock('@/hooks/usePageVisibility', () => ({ usePageVisible: () => tabVisible }))

beforeEach(() => {
  tabVisible = true
  fetchMock.mockReset()
  fetchMock.mockResolvedValue(jsonRes({ buckets: [], rules: [], types: [] }))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('useCephCrush', () => {
  it('loads on first activation only and keeps it after deactivation', async () => {
    const { result, rerender } = renderHook(({ a }) => useCephCrush('c1', a), { wrapper: swrWrapper, initialProps: { a: false } })

    await new Promise(r => setTimeout(r, 20))
    expect(fetchMock).not.toHaveBeenCalled()

    rerender({ a: true })
    await waitFor(() => expect(result.current.crush).not.toBeNull())
    expect(fetchMock).toHaveBeenCalledTimes(1)

    rerender({ a: false })
    expect(result.current.crush).not.toBeNull()
    rerender({ a: true })
    await new Promise(r => setTimeout(r, 20))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('revalidates once on resume when in error, never without error', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) })
    tabVisible = false
    const { result, rerender } = renderHook(() => useCephCrush('c1', true), { wrapper: swrWrapper })

    await waitFor(() => expect(result.current.error).not.toBeNull())
    expect(fetchMock).toHaveBeenCalledTimes(1)

    tabVisible = true
    rerender()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2))
    await new Promise(r => setTimeout(r, 30))
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('no call on resume without error', async () => {
    const { result, rerender } = renderHook(() => useCephCrush('c1', true), { wrapper: swrWrapper })

    await waitFor(() => expect(result.current.crush).not.toBeNull())
    expect(fetchMock).toHaveBeenCalledTimes(1)
    tabVisible = false
    rerender()
    tabVisible = true
    rerender()
    await new Promise(r => setTimeout(r, 30))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
