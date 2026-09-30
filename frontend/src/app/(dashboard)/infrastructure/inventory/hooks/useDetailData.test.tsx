import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act, cleanup } from '@testing-library/react'

import { useDetailData } from './useDetailData'

const fetchDetailsMock = vi.fn()

vi.mock('../helpers', async importOriginal => {
  const actual = await importOriginal<typeof import('../helpers')>()

  return { ...actual, fetchDetails: (...a: any[]) => fetchDetailsMock(...a) }
})

// selection.id format for a VM is connId:node:type:vmid
const VM_SELECTION = { type: 'vm', id: 'conn-1:pve1:qemu:100' } as any

let fetchSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
  fetchDetailsMock.mockReset()
  fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({
    json: async () => ({ data: { cpu: 0.25, mem: 2147483648, maxmem: 4294967296, disk: 0, maxdisk: 34359738368 } }),
  } as any)
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('useDetailData', () => {
  it('loads the details of the selection on mount and exposes its tags', async () => {
    fetchDetailsMock.mockResolvedValue({ title: 'web-01', vmRealStatus: 'stopped', tags: ['prod', 'web'] })

    const { result } = renderHook(() => useDetailData(VM_SELECTION))

    await waitFor(() => expect(result.current.data).not.toBeNull())
    expect(fetchDetailsMock).toHaveBeenCalledWith(VM_SELECTION)
    expect(result.current.data?.title).toBe('web-01')
    expect(result.current.localTags).toEqual(['prod', 'web'])
    expect(result.current.loading).toBe(false)
    expect(result.current.error).toBeNull()
  })

  it('surfaces the fetch error message', async () => {
    fetchDetailsMock.mockRejectedValue(new Error('connection refused'))

    const { result } = renderHook(() => useDetailData(VM_SELECTION))

    await waitFor(() => expect(result.current.error).toBe('connection refused'))
    expect(result.current.loading).toBe(false)
  })

  it('polls the live status of a running VM right away and maps it to metrics', async () => {
    fetchDetailsMock.mockResolvedValue({ title: 'web-01', vmRealStatus: 'running', tags: [] })

    const { result } = renderHook(() => useDetailData(VM_SELECTION))

    await waitFor(() => expect((result.current.data as any)?.metrics?.ram).toBeDefined())
    expect(fetchSpy).toHaveBeenCalledWith('/api/v1/connections/conn-1/guests/qemu/pve1/100/status', { cache: 'no-store' })
    const metrics = (result.current.data as any).metrics
    expect(metrics.ram).toMatchObject({ pct: 50, used: 2147483648, max: 4294967296 })
    expect(metrics.storage).toMatchObject({ used: 0, max: 34359738368 })
  })

  it('refreshes the full details of a VM every 30 s while the tab is visible', async () => {
    vi.useFakeTimers()
    fetchDetailsMock
      .mockResolvedValueOnce({ title: 'web-01', vmRealStatus: 'stopped', tags: [] })
      .mockResolvedValue({ title: 'web-01', vmRealStatus: 'stopped', tags: ['pending-reboot'] })

    const { result } = renderHook(() => useDetailData(VM_SELECTION))

    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(result.current.data?.title).toBe('web-01')
    expect(fetchDetailsMock).toHaveBeenCalledTimes(1)

    await act(async () => { await vi.advanceTimersByTimeAsync(30_000) })

    expect(fetchDetailsMock).toHaveBeenCalledTimes(2)
    expect(result.current.localTags).toEqual(['pending-reboot'])
  })
})
