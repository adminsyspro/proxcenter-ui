import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, cleanup, act } from '@testing-library/react'

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
    expect(fetchSpy).toHaveBeenCalledWith(`/api/v1/guests/${encodeURIComponent('conn-1:qemu:pve1:100')}/notes`, { cache: 'no-store', signal: expect.any(AbortSignal) })
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

  it('never shows the previous guest notes and still loads the new ones (A -> B while A is pending)', async () => {
    const B = { type: 'vm', id: 'conn-1:pve2:lxc:200' } as any
    let releaseA!: () => void
    const aGate = new Promise<void>(r => { releaseA = r })

    fetchSpy.mockImplementation(async (url: any) => {
      if (String(url).includes('qemu')) {
        await aGate

        return { json: async () => ({ data: { content: 'notes of A' } }) } as any
      }

      return { json: async () => ({ data: { content: 'notes of B' } }) } as any
    })

    const t = (k: string) => k
    const { result, rerender } = renderHook(p => useNotes(p), { initialProps: { selection: SELECTION, detailTab: 6, t } })

    await waitFor(() => expect(result.current.notesLoading).toBe(true))
    rerender({ selection: B, detailTab: 6, t })
    act(() => { result.current.resetNotes() })

    await waitFor(() => expect(result.current.vmNotes).toBe('notes of B'))
    await act(async () => { releaseA(); await aGate })
    expect(result.current.vmNotes).toBe('notes of B')
    expect(result.current.notesLoading).toBe(false)
  })

  it('saves the notes but drops the outcome once the user moved to another guest', async () => {
    const B = { type: 'vm', id: 'conn-1:pve2:lxc:200' } as any
    let releaseSave!: () => void
    const saveGate = new Promise<void>(r => { releaseSave = r })

    fetchSpy.mockImplementation(async (_url: any, init?: any) => {
      if (init?.method === 'PUT') {
        await saveGate

        return { json: async () => ({ error: 'locked' }) } as any
      }

      return { json: async () => ({ data: { content: '' } }) } as any
    })

    const t = (k: string) => k
    const { result, rerender } = renderHook(p => useNotes(p), { initialProps: { selection: SELECTION, detailTab: 1, t } })

    let pending!: Promise<void>
    act(() => { pending = result.current.saveNotes() })
    expect(result.current.notesSaving).toBe(true)
    expect(fetchSpy.mock.calls.some((c: any[]) => (c[1] as any)?.method === 'PUT')).toBe(true)

    rerender({ selection: B, detailTab: 1, t })
    act(() => { result.current.resetNotes() })
    await act(async () => { releaseSave(); await pending })

    expect(result.current.notesError).toBeNull()
    expect(result.current.notesSaving).toBe(false)
  })

  it('surfaces a save error for the guest still displayed', async () => {
    fetchSpy.mockImplementation(async (_url: any, init?: any) => {
      if (init?.method === 'PUT') throw new Error('network down')

      return { json: async () => ({ data: { content: '' } }) } as any
    })

    const { result } = renderHook(() => useNotes({ selection: SELECTION, detailTab: 1, t: k => k }))

    await act(async () => { await result.current.saveNotes() })
    expect(result.current.notesError).toBe('network down')
    expect(result.current.notesSaving).toBe(false)
  })

  it('a load fired from a closure of the previous guest sends nothing', async () => {
    const t = (k: string) => k
    const { result, rerender } = renderHook(p => useNotes(p), { initialProps: { selection: SELECTION, detailTab: 1, t } })
    const staleLoad = result.current.loadNotes

    rerender({ selection: { type: 'vm', id: 'conn-1:pve2:lxc:200' } as any, detailTab: 1, t })
    await act(async () => { await staleLoad() })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('surfaces a load failure of the guest displayed', async () => {
    fetchSpy.mockRejectedValue(new Error('pve down'))
    const { result } = renderHook(() => useNotes({ selection: SELECTION, detailTab: 6, t: k => k }))

    await waitFor(() => expect(result.current.notesError).toBe('pve down'))
  })
})
