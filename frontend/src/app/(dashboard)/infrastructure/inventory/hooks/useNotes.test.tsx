import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, cleanup } from '@testing-library/react'

import { useNotes } from './useNotes'

const SELECTION = { type: 'vm', id: 'conn-1:pve1:qemu:100' } as any

let fetchSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue({ json: async () => ({ data: { content: '# Web server\nOwner: ops' } }) } as any)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('useNotes', () => {
  it('loads the VM notes when the Notes tab is opened', async () => {
    const { result } = renderHook(() => useNotes({ selection: SELECTION, detailTab: 6, t: k => k }))

    await waitFor(() => expect(result.current.vmNotes).toBe('# Web server\nOwner: ops'))
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    expect(fetchSpy).toHaveBeenCalledWith(`/api/v1/guests/${encodeURIComponent('conn-1:qemu:pve1:100')}/notes`, { cache: 'no-store' })
  })

  it('surfaces the API error', async () => {
    fetchSpy.mockResolvedValue({ json: async () => ({ error: 'VM not found' }) } as any)

    const { result } = renderHook(() => useNotes({ selection: SELECTION, detailTab: 0, t: k => k }))

    await waitFor(() => expect(result.current.notesError).toBe('VM not found'))
  })

  it('does not load on another tab', () => {
    renderHook(() => useNotes({ selection: SELECTION, detailTab: 3, t: k => k }))
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
