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
    expect(fetchDetailsMock).toHaveBeenCalledWith(VM_SELECTION, expect.any(AbortSignal))
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
    expect(fetchSpy).toHaveBeenCalledWith('/api/v1/connections/conn-1/guests/qemu/pve1/100/status', { cache: 'no-store', signal: expect.any(AbortSignal) })
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

  it('drops a refresh answered after the user switched to another selection', async () => {
    const B = { type: 'vm', id: 'conn-1:pve2:lxc:200' } as any
    let releaseA!: (v: any) => void

    fetchDetailsMock.mockImplementation((sel: any) => {
      if (sel.id === VM_SELECTION.id && fetchDetailsMock.mock.calls.length > 1) return new Promise(r => { releaseA = r })

      return Promise.resolve({ title: sel.id === B.id ? 'vm-b' : 'vm-a', vmRealStatus: 'stopped', tags: [sel.id] })
    })

    const { result, rerender } = renderHook(({ s }) => useDetailData(s), { initialProps: { s: VM_SELECTION } })

    await waitFor(() => expect(result.current.data?.title).toBe('vm-a'))

    let pending!: Promise<void>
    act(() => { pending = result.current.refreshData() })
    expect(result.current.refreshing).toBe(true)
    const refreshSignal = fetchDetailsMock.mock.calls[1][1] as AbortSignal

    rerender({ s: B })
    await waitFor(() => expect(result.current.data?.title).toBe('vm-b'))
    expect(refreshSignal.aborted).toBe(true)
    // The refresh still pending for A no longer locks B's own refresh out.
    expect(result.current.refreshing).toBe(false)

    await act(async () => { releaseA({ title: 'vm-a', vmRealStatus: 'stopped', tags: ['stale'] }); await pending })
    expect(result.current.data?.title).toBe('vm-b')
    expect(result.current.localTags).toEqual([B.id])
  })

  it('drops the error of a refresh that went stale', async () => {
    const B = { type: 'vm', id: 'conn-1:pve2:lxc:200' } as any
    let failA!: (e: Error) => void
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    fetchDetailsMock.mockImplementation((sel: any) => {
      if (sel.id === VM_SELECTION.id && fetchDetailsMock.mock.calls.length > 1) return new Promise((_r, rej) => { failA = rej })

      return Promise.resolve({ title: sel.id, vmRealStatus: 'stopped', tags: [] })
    })

    const { result, rerender } = renderHook(({ s }) => useDetailData(s), { initialProps: { s: VM_SELECTION } })

    await waitFor(() => expect(result.current.data).not.toBeNull())
    let pending!: Promise<void>
    act(() => { pending = result.current.refreshData() })
    rerender({ s: B })
    await waitFor(() => expect(result.current.data?.title).toBe(B.id))

    await act(async () => { failA(new Error('aborted')); await pending })
    expect(errSpy).not.toHaveBeenCalled()
  })

  it('ignores the main load of a selection the user already left', async () => {
    const B = { type: 'vm', id: 'conn-1:pve2:lxc:200' } as any
    let releaseA!: (v: any) => void

    fetchDetailsMock.mockImplementation((sel: any) =>
      sel.id === B.id ? Promise.resolve({ title: 'vm-b', vmRealStatus: 'stopped', tags: [] }) : new Promise(r => { releaseA = r }))

    const { result, rerender } = renderHook(({ s }) => useDetailData(s), { initialProps: { s: VM_SELECTION } })

    rerender({ s: B })
    await waitFor(() => expect(result.current.data?.title).toBe('vm-b'))
    await act(async () => { releaseA({ title: 'vm-a', vmRealStatus: 'stopped', tags: [] }); await Promise.resolve() })
    expect(result.current.data?.title).toBe('vm-b')
    expect(result.current.loading).toBe(false)
  })

  it('never paints the live metrics of the previous guest on the new one', async () => {
    const B = { type: 'vm', id: 'conn-1:pve2:lxc:200' } as any
    let releaseA!: () => void
    const aGate = new Promise<void>(r => { releaseA = r })

    fetchDetailsMock.mockImplementation((sel: any) => Promise.resolve({ title: sel.id, vmRealStatus: 'running', tags: [] }))
    fetchSpy.mockImplementation(async (url: any) => {
      if (String(url).includes('/qemu/')) {
        await aGate

        return { json: async () => ({ data: { cpu: 0.99, mem: 99, maxmem: 100, disk: 0, maxdisk: 1 } }) } as any
      }

      return { json: async () => ({ data: { cpu: 0.01, mem: 1, maxmem: 100, disk: 0, maxdisk: 1 } }) } as any
    })

    const { result, rerender } = renderHook(({ s }) => useDetailData(s), { initialProps: { s: VM_SELECTION } })

    await waitFor(() => expect(fetchSpy.mock.calls.some((c: any[]) => String(c[0]).includes('/qemu/'))).toBe(true))
    const aSignal = (fetchSpy.mock.calls.find((c: any[]) => String(c[0]).includes('/qemu/'))![1] as any).signal as AbortSignal

    rerender({ s: B })
    await waitFor(() => expect((result.current.data as any)?.metrics?.ram?.pct).toBe(1))
    expect(aSignal.aborted).toBe(true)

    await act(async () => { releaseA(); await aGate; await Promise.resolve() })
    expect((result.current.data as any).title).toBe(B.id)
    expect((result.current.data as any).metrics.ram.pct).toBe(1)
  })

  it('polls the live status of an online node and maps it to metrics', async () => {
    const NODE = { type: 'node', id: 'conn-1:pve1' } as any

    fetchDetailsMock.mockResolvedValue({ title: 'pve1', status: 'ok', tags: [], metrics: { cpu: { label: 'CPU', pct: 0 } } })
    fetchSpy.mockResolvedValue({ json: async () => ({ data: { cpu: 0.5, memory: { used: 1, total: 4 }, rootfs: { used: 1, total: 2 } } }) } as any)

    const { result } = renderHook(() => useDetailData(NODE))

    await waitFor(() => expect((result.current.data as any)?.metrics?.ram?.pct).toBe(25))
    expect(fetchSpy).toHaveBeenCalledWith('/api/v1/connections/conn-1/nodes/pve1/status', { cache: 'no-store', signal: expect.any(AbortSignal) })
    expect((result.current.data as any).metrics.storage.pct).toBe(50)
  })

  it('a refresh fired from a closure of the previous selection sends nothing', async () => {
    fetchDetailsMock.mockResolvedValue({ title: 'vm', vmRealStatus: 'stopped', tags: [] })
    const { result, rerender } = renderHook(({ s }) => useDetailData(s), { initialProps: { s: VM_SELECTION } })

    await waitFor(() => expect(result.current.data).not.toBeNull())
    const staleRefresh = result.current.refreshData
    rerender({ s: { type: 'vm', id: 'conn-1:pve2:lxc:200' } as any })
    await waitFor(() => expect(fetchDetailsMock).toHaveBeenCalledTimes(2))

    await act(async () => { await staleRefresh() })
    expect(fetchDetailsMock).toHaveBeenCalledTimes(2)
  })

  it('logs a refresh failure of the selection displayed', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    fetchDetailsMock.mockResolvedValueOnce({ title: 'vm', vmRealStatus: 'stopped', tags: [] }).mockRejectedValue(new Error('pve down'))
    const { result } = renderHook(() => useDetailData(VM_SELECTION))

    await waitFor(() => expect(result.current.data).not.toBeNull())
    await act(async () => { await result.current.refreshData() })
    expect(errSpy).toHaveBeenCalledWith('Refresh error:', expect.any(Error))
    expect(result.current.refreshing).toBe(false)
  })

  it('drops the error of a main load answered after the switch', async () => {
    let failA!: (e: Error) => void
    fetchDetailsMock.mockImplementation((sel: any) => sel.id === VM_SELECTION.id
      ? new Promise((_r, rej) => { failA = rej })
      : Promise.resolve({ title: 'vm-b', vmRealStatus: 'stopped', tags: [] }))
    const { result, rerender } = renderHook(({ s }) => useDetailData(s), { initialProps: { s: VM_SELECTION } })

    rerender({ s: { type: 'vm', id: 'conn-1:pve2:lxc:200' } as any })
    await waitFor(() => expect(result.current.data?.title).toBe('vm-b'))
    await act(async () => { failA(new Error('A failed')); await Promise.resolve() })
    expect(result.current.error).toBeNull()
  })

  it('drops a node live status answered after the switch', async () => {
    const NODE = { type: 'node', id: 'conn-1:pve1' } as any
    let releaseNode!: () => void
    const gate = new Promise<void>(r => { releaseNode = r })

    fetchDetailsMock.mockImplementation((sel: any) => Promise.resolve(sel.type === 'node'
      ? { title: 'pve1', status: 'ok', tags: [] }
      : { title: 'vm', vmRealStatus: 'stopped', tags: [] }))
    fetchSpy.mockImplementation(async () => {
      await gate

      return { json: async () => ({ data: { cpu: 0.5, memory: { used: 1, total: 4 } } }) } as any
    })

    const { result, rerender } = renderHook(({ s }) => useDetailData(s), { initialProps: { s: NODE } })

    await waitFor(() => expect(fetchSpy).toHaveBeenCalled())
    rerender({ s: VM_SELECTION })
    await waitFor(() => expect(result.current.data?.title).toBe('vm'))
    await act(async () => { releaseNode(); await gate; await Promise.resolve() })
    expect((result.current.data as any).metrics).toBeUndefined()
  })
})
