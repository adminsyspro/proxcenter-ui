import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, cleanup, act } from '@testing-library/react'

import { useTasks } from './useTasks'

const SELECTION = { type: 'vm', id: 'conn-1:pve1:qemu:100' } as any
const TASK = { upid: 'UPID:pve1:0001A2B3:04C5D6E7:65F01234:qmstart:100:root@pam:', type: 'qmstart', status: 'OK' }

let fetchSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({ json: async () => ({ data: { tasks: [TASK] } }) } as any)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('useTasks', () => {
  it('loads the VM task history when the tasks tab is opened', async () => {
    const { result } = renderHook(() => useTasks({ selection: SELECTION, detailTab: 3, t: k => k }))

    await waitFor(() => expect(result.current.tasksLoaded).toBe(true))
    expect(result.current.tasks).toEqual([TASK])
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(fetchSpy).toHaveBeenCalledWith(`/api/v1/guests/${encodeURIComponent('conn-1:qemu:pve1:100')}/tasks`, { cache: 'no-store', signal: expect.any(AbortSignal) })
  })

  it('does not load on another tab', () => {
    renderHook(() => useTasks({ selection: SELECTION, detailTab: 0, t: k => k }))
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('never shows the previous guest history and still loads the new one (A -> B while A is pending)', async () => {
    const B = { type: 'vm', id: 'conn-1:pve2:lxc:200' } as any
    let releaseA!: () => void
    const aGate = new Promise<void>(r => { releaseA = r })

    fetchSpy.mockImplementation(async (url: any) => {
      if (String(url).includes('qemu')) {
        await aGate

        return { json: async () => ({ data: { tasks: [{ upid: 'A' }] } }) } as any
      }

      return { json: async () => ({ data: { tasks: [{ upid: 'B' }] } }) } as any
    })

    const t = (k: string) => k
    const { result, rerender } = renderHook(p => useTasks(p), { initialProps: { selection: SELECTION, detailTab: 3, t } })

    await waitFor(() => expect(result.current.tasksLoading).toBe(true))
    const aSignal = (fetchSpy.mock.calls[0][1] as any).signal as AbortSignal

    // What InventoryDetails does on a selection change.
    rerender({ selection: B, detailTab: 3, t })
    act(() => { result.current.resetTasks() })

    expect(aSignal.aborted).toBe(true)
    await waitFor(() => expect(result.current.tasks).toEqual([{ upid: 'B' }]))

    await act(async () => { releaseA(); await aGate })
    expect(result.current.tasks).toEqual([{ upid: 'B' }])
    expect(result.current.tasksLoaded).toBe(true)
    expect(result.current.tasksLoading).toBe(false)
  })

  it('drops the error of a load that went stale', async () => {
    const B = { type: 'vm', id: 'conn-1:pve2:lxc:200' } as any
    let failA!: (e: Error) => void

    fetchSpy.mockImplementation((url: any) => {
      if (String(url).includes('qemu')) return new Promise((_r, rej) => { failA = rej }) as any

      return Promise.resolve({ json: async () => ({ data: { tasks: [] } }) } as any)
    })

    const t = (k: string) => k
    const { result, rerender } = renderHook(p => useTasks(p), { initialProps: { selection: SELECTION, detailTab: 3, t } })

    await waitFor(() => expect(result.current.tasksLoading).toBe(true))
    rerender({ selection: B, detailTab: 3, t })
    act(() => { result.current.resetTasks() })
    await waitFor(() => expect(result.current.tasksLoaded).toBe(true))

    await act(async () => { failA(new Error('A failed')); await Promise.resolve() })
    expect(result.current.tasksError).toBeNull()
  })

  it('a load fired from a closure of the previous guest sends nothing', async () => {
    const t = (k: string) => k
    const { result, rerender } = renderHook(p => useTasks(p), { initialProps: { selection: SELECTION, detailTab: 0, t } })
    const staleLoad = result.current.loadTasks

    rerender({ selection: { type: 'vm', id: 'conn-1:pve2:lxc:200' } as any, detailTab: 0, t })
    await act(async () => { await staleLoad() })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('surfaces a load failure of the guest displayed', async () => {
    fetchSpy.mockRejectedValue(new Error('pve down'))
    const { result } = renderHook(() => useTasks({ selection: SELECTION, detailTab: 3, t: k => k }))

    await waitFor(() => expect(result.current.tasksError).toBe('pve down'))
    expect(result.current.tasksLoading).toBe(false)
  })
})
