import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, renderHook } from '@testing-library/react'

const { swrMock } = vi.hoisted(() => ({ swrMock: vi.fn() }))

vi.mock('@/hooks/useSWRFetch', () => ({ useSWRFetch: (...a: any[]) => swrMock(...a) }))

beforeEach(() => {
  swrMock.mockReset().mockReturnValue({ data: undefined, isLoading: true })
})

afterEach(() => {
  cleanup()
})

describe('useBroadcasts', () => {
  it('polls the active endpoint once a minute and revalidates on focus', async () => {
    const { useBroadcasts } = await import('./useBroadcasts')
    renderHook(() => useBroadcasts())
    expect(swrMock).toHaveBeenCalledWith(
      '/api/v1/broadcasts/active',
      expect.objectContaining({ refreshInterval: 60000, revalidateOnFocus: true }),
    )
  })

  it('returns an empty list while loading', async () => {
    const { useBroadcasts } = await import('./useBroadcasts')
    const { result } = renderHook(() => useBroadcasts())
    expect(result.current.banners).toEqual([])
    expect(result.current.isLoading).toBe(true)
  })

  it('returns the payload list once loaded', async () => {
    swrMock.mockReturnValue({ data: { data: [{ id: 'a' }] }, isLoading: false })
    const { useBroadcasts } = await import('./useBroadcasts')
    const { result } = renderHook(() => useBroadcasts())
    expect(result.current.banners).toEqual([{ id: 'a' }])
  })

  it('tolerates a malformed payload', async () => {
    swrMock.mockReturnValue({ data: { data: 'nope' }, isLoading: false })
    const { useBroadcasts } = await import('./useBroadcasts')
    const { result } = renderHook(() => useBroadcasts())
    expect(result.current.banners).toEqual([])
  })
})
