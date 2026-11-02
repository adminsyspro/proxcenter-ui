import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, renderHook, waitFor } from '@testing-library/react'

import { jsonRes, swrWrapper } from './testUtils'
import { useCephHistory } from './useCephHistory'
import { useCockpitUrlState } from './useCockpitUrlState'

let search = 'conn=c1&range=7d'
let license = { enterprise: true, resolved: true }
const replace = vi.fn((url: string) => { search = url.split('?')[1] ?? '' })
const fetchMock = vi.fn()

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace }),
  usePathname: () => '/storage/ceph',
  useSearchParams: () => new URLSearchParams(search),
}))
vi.mock('./useCockpitLicense', () => ({ useCockpitLicense: () => license }))

beforeEach(() => {
  search = 'conn=c1&range=7d'
  license = { enterprise: true, resolved: true }
  replace.mockClear()
  fetchMock.mockReset()
  fetchMock.mockResolvedValue(jsonRes({ points: [], slowest_osds: [] }))
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('licence Enterprise -> Community while the page is open', () => {
  it('stops history calls and brings range back to live', async () => {
    const { result, rerender } = renderHook(() => {
      const url = useCockpitUrlState()
      const hist = useCephHistory(url.conn, url.range, license.enterprise)

      return { url, hist }
    }, { wrapper: swrWrapper })

    await waitFor(() => expect(result.current.hist.history).not.toBeNull())
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(result.current.url.range).toBe('7d')

    license = { enterprise: false, resolved: true }
    rerender()
    // meme avant que l'URL soit corrigee, l'historique Enterprise n'est plus servi
    expect(result.current.hist.history).toBeNull()
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/storage/ceph?conn=c1&range=live'))
    rerender()
    expect(result.current.url.range).toBe('live')
    expect(result.current.hist.history).toBeNull()
    await new Promise(r => setTimeout(r, 30))
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
