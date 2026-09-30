import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, cleanup } from '@testing-library/react'

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
    expect(fetchSpy).toHaveBeenCalledWith(`/api/v1/guests/${encodeURIComponent('conn-1:qemu:pve1:100')}/tasks`, { cache: 'no-store' })
  })

  it('does not load on another tab', () => {
    renderHook(() => useTasks({ selection: SELECTION, detailTab: 0, t: k => k }))
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
