import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act, cleanup } from '@testing-library/react'

import { useResourceData } from './useResourceData'

const mutate = vi.fn()
const swrMock = vi.fn()

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => 'fr',
}))

vi.mock('@/hooks/useSWRFetch', () => ({
  useSWRFetch: (...a: any[]) => swrMock(...a),
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('useResourceData', () => {
  it('keys the overview on connection and locale, and loadData revalidates it', () => {
    swrMock.mockReturnValue({ data: { data: { kpis: { vms: 12 } } }, error: undefined, isLoading: false, mutate })

    const { result } = renderHook(() => useResourceData('conn-1'))

    expect(swrMock).toHaveBeenCalledWith('/api/v1/resources/overview?connectionId=conn-1#fr', { revalidateOnFocus: false })
    expect(result.current.kpis).toEqual({ vms: 12 })

    act(() => result.current.loadData())

    expect(mutate).toHaveBeenCalledTimes(1)
  })

  it('omits the query string without a connection and maps the SWR error', () => {
    swrMock.mockReturnValue({ data: undefined, error: new Error('boom'), isLoading: false, mutate })

    const { result } = renderHook(() => useResourceData())

    expect(swrMock).toHaveBeenCalledWith('/api/v1/resources/overview#fr', { revalidateOnFocus: false })
    expect(result.current.error).toBe('boom')
    expect(result.current.kpis).toBeNull()
  })
})
