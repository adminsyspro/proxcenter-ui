import { renderHook, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'

import { inventoryFixture } from '../components/fixtures'

import { useInventoryOptions } from './useSlaLists'

const fetchMock = vi.fn()

const inventoryCalls = () => fetchMock.mock.calls.filter(c => c[0] === '/api/v1/inventory').length

beforeEach(() => {
  fetchMock.mockReset().mockResolvedValue({ ok: true, status: 200, text: async () => JSON.stringify(inventoryFixture) })
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => vi.unstubAllGlobals())

// One SWRConfig for the whole test, like the app: a dialog opens and closes under it, so the
// hook goes from an idle key to the inventory key and back. No deduping from the wrapper: only
// the hook's own options may keep an opening from fetching.
const wrapper = ({ children }: { children: ReactNode }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>
)

const mount = () => renderHook(({ open }) => useInventoryOptions(open), { wrapper, initialProps: { open: true } })

describe('useInventoryOptions', () => {
  it('asks the inventory once however many times a dialog is opened', async () => {
    const view = mount()

    await waitFor(() => expect(view.result.current.options.guests).toHaveLength(2))

    view.rerender({ open: false })
    // Let SWR forget a finished request if it were going to.
    await new Promise(resolve => setTimeout(resolve, 20))
    view.rerender({ open: true })

    // A stale-while-revalidate refetch starts on the next frame: give it the time to show.
    await new Promise(resolve => setTimeout(resolve, 100))

    expect(view.result.current.options.guests).toHaveLength(2)
    expect(inventoryCalls()).toBe(1)
  })

  it('asks again for an opening more than a minute after the last one, the cached copy shown meanwhile', async () => {
    // Fake timers: SWR forgets a request through a setTimeout of dedupingInterval, which
    // advancing the clock fires (Date.now alone would not). shouldAdvanceTime keeps waitFor polling.
    vi.useFakeTimers({ shouldAdvanceTime: true })

    try {
      const view = mount()

      await waitFor(() => expect(view.result.current.options.guests).toHaveLength(2))
      view.rerender({ open: false })

      await vi.advanceTimersByTimeAsync(61000)
      view.rerender({ open: true })

      expect(view.result.current.options.guests).toHaveLength(2)
      await waitFor(() => expect(inventoryCalls()).toBe(2))
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not fetch while closed', () => {
    renderHook(() => useInventoryOptions(false), { wrapper })

    expect(fetchMock).not.toHaveBeenCalled()
  })
})
