import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act, cleanup } from '@testing-library/react'

import { useHA } from './useHA'

const SELECTION = { type: 'vm', id: 'conn-1:pve1:qemu:100' } as any
const HA_URL = '/api/v1/connections/conn-1/ha/vm%3A100'
const GROUPS_URL = '/api/v1/connections/conn-1/ha'

function makeParams(over: Partial<any> = {}) {
  return {
    selection: SELECTION,
    detailTab: 0,
    t: (k: string) => k,
    data: { title: 'web-01' },
    setConfirmAction: vi.fn(),
    setConfirmActionLoading: vi.fn(),
    ...over,
  }
}

let fetchSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(async (input: any, init?: any) => {
    const url = String(input)

    if (init?.method === 'POST' || init?.method === 'DELETE') return { json: async () => ({ data: null }) } as any
    if (url === GROUPS_URL) return { json: async () => ({ data: { groups: [{ group: 'prod-ha' }] } }) } as any

    return {
      json: async () => ({ data: { state: 'started', group: 'prod-ha', max_restart: 3, max_relocate: 2, failback: 0, comment: 'critical' } }),
    } as any
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const haConfigGets = () => fetchSpy.mock.calls.filter(c => c[0] === HA_URL && !(c[1] as any)?.method).length

describe('useHA', () => {
  it('loads the HA config and fills the form when the HA tab is opened', async () => {
    const { result } = renderHook(() => useHA(makeParams({ detailTab: 9 })))

    await waitFor(() => expect(result.current.haLoaded).toBe(true))
    expect(fetchSpy).toHaveBeenCalledWith(HA_URL, { cache: 'no-store', signal: expect.any(AbortSignal) })
    expect(result.current.haGroups).toEqual([{ group: 'prod-ha' }])
    expect(result.current.haGroup).toBe('prod-ha')
    expect(result.current.haMaxRestart).toBe(3)
    expect(result.current.haMaxRelocate).toBe(2)
    expect(result.current.haFailback).toBe(false)
    expect(result.current.haComment).toBe('critical')
  })

  it('does not load on another tab', () => {
    renderHook(() => useHA(makeParams({ detailTab: 0 })))
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('saves the form then reloads the config', async () => {
    const { result } = renderHook(() => useHA(makeParams()))

    act(() => {
      result.current.setHaState('stopped')
      result.current.setHaEditing(true)
    })

    await act(async () => { await result.current.saveHaConfig() })

    const post = fetchSpy.mock.calls.find(c => (c[1] as any)?.method === 'POST')!
    expect(post[0]).toBe(HA_URL)
    expect(JSON.parse((post[1] as any).body)).toMatchObject({ state: 'stopped', max_restart: 1, max_relocate: 1, failback: true })

    await waitFor(() => expect(result.current.haLoaded).toBe(true))
    expect(haConfigGets()).toBe(1)
    expect(result.current.haEditing).toBe(false)
  })

  it('asks for confirmation, then deletes the HA resource and resets the form', async () => {
    const params = makeParams()
    const { result } = renderHook(() => useHA(params))

    act(() => result.current.setHaComment('to be removed'))
    act(() => result.current.removeHaConfig())

    const confirm = params.setConfirmAction.mock.calls[0][0]
    expect(confirm).toMatchObject({ action: 'disable-ha', vmName: 'web-01' })

    await act(async () => { await confirm.onConfirm() })

    expect(fetchSpy).toHaveBeenCalledWith(HA_URL, { method: 'DELETE' })
    expect(result.current.haConfig).toBeNull()
    expect(result.current.haComment).toBe('')
    expect(params.setConfirmAction).toHaveBeenLastCalledWith(null)
    expect(params.setConfirmActionLoading).toHaveBeenLastCalledWith(false)
  })

  it('never fills the HA form of a guest with the previous guest config (A -> B while A is pending)', async () => {
    const B = { type: 'vm', id: 'conn-1:pve2:lxc:200' } as any
    let releaseA!: () => void
    const aGate = new Promise<void>(r => { releaseA = r })

    fetchSpy.mockImplementation(async (input: any) => {
      const url = String(input)

      if (url === GROUPS_URL) return { json: async () => ({ data: { groups: [] } }) } as any
      if (url === HA_URL) {
        await aGate

        return { json: async () => ({ data: { state: 'started', group: 'group-of-A', max_restart: 9 } }) } as any
      }

      return { json: async () => ({ data: null }) } as any
    })

    const { result, rerender } = renderHook(p => useHA(p), { initialProps: makeParams({ detailTab: 9 }) })

    await waitFor(() => expect(result.current.haLoading).toBe(true))
    rerender(makeParams({ detailTab: 9, selection: B }))
    act(() => { result.current.resetHA() })

    await waitFor(() => expect(result.current.haLoaded).toBe(true))
    await act(async () => { releaseA(); await aGate; await Promise.resolve() })

    expect(result.current.haConfig).toBeNull()
    expect(result.current.haGroup).toBe('')
    expect(result.current.haMaxRestart).toBe(1)
    expect(result.current.haLoading).toBe(false)
    expect(fetchSpy.mock.calls.some((c: any[]) => String(c[0]).includes('ct%3A200'))).toBe(true)
  })

  it('removes the HA resource but leaves the next guest HA state alone once the user moved on', async () => {
    const B = { type: 'vm', id: 'conn-1:pve2:lxc:200' } as any
    let releaseDelete!: () => void
    const deleteGate = new Promise<void>(r => { releaseDelete = r })

    fetchSpy.mockImplementation(async (input: any, init?: any) => {
      if (init?.method === 'DELETE') {
        await deleteGate

        return { json: async () => ({ data: null }) } as any
      }
      if (String(input) === GROUPS_URL) return { json: async () => ({ data: { groups: [] } }) } as any

      return { json: async () => ({ data: { state: 'started', group: 'group-of-B' } }) } as any
    })

    const params = makeParams({ detailTab: 9 })
    const { result, rerender } = renderHook(p => useHA(p), { initialProps: params })

    await waitFor(() => expect(result.current.haLoaded).toBe(true))
    act(() => { result.current.removeHaConfig() })
    const confirm = params.setConfirmAction.mock.calls.at(-1)![0]
    let pending!: Promise<void>
    act(() => { pending = confirm.onConfirm() })

    const paramsB = makeParams({ detailTab: 9, selection: B, setConfirmAction: params.setConfirmAction, setConfirmActionLoading: params.setConfirmActionLoading })
    rerender(paramsB)
    act(() => { result.current.resetHA() })
    await waitFor(() => expect(result.current.haGroup).toBe('group-of-B'))

    await act(async () => { releaseDelete(); await pending })

    // The shared confirm dialog is closed, B's HA state is untouched.
    expect(params.setConfirmAction).toHaveBeenLastCalledWith(null)
    expect(params.setConfirmActionLoading).toHaveBeenLastCalledWith(false)
    expect(result.current.haConfig).not.toBeNull()
    expect(result.current.haGroup).toBe('group-of-B')
  })

  it('a load fired from a closure of the previous guest sends nothing', async () => {
    const { result, rerender } = renderHook(p => useHA(p), { initialProps: makeParams() })
    const staleLoad = result.current.loadHaConfig

    rerender(makeParams({ selection: { type: 'vm', id: 'conn-1:pve2:lxc:200' } }))
    await act(async () => { await staleLoad() })
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('surfaces load, save and removal failures of the guest displayed', async () => {
    fetchSpy.mockRejectedValue(new Error('pve down'))
    const params = makeParams({ detailTab: 9 })
    const { result } = renderHook(() => useHA(params))

    await waitFor(() => expect(result.current.haError).toBe('pve down'))

    fetchSpy.mockRejectedValue(new Error('save refused'))
    await act(async () => { await result.current.saveHaConfig() })
    expect(result.current.haError).toBe('save refused')

    fetchSpy.mockRejectedValue(new Error('delete refused'))
    act(() => { result.current.removeHaConfig() })
    await act(async () => { await params.setConfirmAction.mock.calls.at(-1)![0].onConfirm() })
    expect(result.current.haError).toBe('delete refused')
    expect(result.current.haSaving).toBe(false)
  })

  it('drops the outcome of a save answered after the switch', async () => {
    let releaseSave!: () => void
    const gate = new Promise<void>(r => { releaseSave = r })
    fetchSpy.mockImplementation(async (_input: any, init?: any) => {
      if (init?.method === 'POST') {
        await gate

        return { json: async () => ({ error: 'refused for A' }) } as any
      }

      return { json: async () => ({ data: null }) } as any
    })
    const { result, rerender } = renderHook(p => useHA(p), { initialProps: makeParams() })

    let pending!: Promise<void>
    act(() => { pending = result.current.saveHaConfig() })
    rerender(makeParams({ selection: { type: 'vm', id: 'conn-1:pve2:lxc:200' } }))
    act(() => { result.current.resetHA() })
    await act(async () => { releaseSave(); await pending })

    expect(result.current.haError).toBeNull()
    expect(result.current.haSaving).toBe(false)
  })

  it('drops the failure of a save answered after the switch', async () => {
    let failSave!: (e: Error) => void
    fetchSpy.mockImplementation((_input: any, init?: any) => init?.method === 'POST'
      ? new Promise((_r, rej) => { failSave = rej }) as any
      : Promise.resolve({ json: async () => ({ data: null }) } as any))
    const { result, rerender } = renderHook(p => useHA(p), { initialProps: makeParams() })

    let pending!: Promise<void>
    act(() => { pending = result.current.saveHaConfig() })
    rerender(makeParams({ selection: { type: 'vm', id: 'conn-1:pve2:lxc:200' } }))
    await act(async () => { failSave(new Error('A failed')); await pending })
    expect(result.current.haError).toBeNull()
  })

  it('drops the failure of a load answered after the switch', async () => {
    let failA!: (e: Error) => void
    fetchSpy.mockImplementation((input: any) => String(input) === HA_URL
      ? new Promise((_r, rej) => { failA = rej }) as any
      : Promise.resolve({ json: async () => ({ data: null }) } as any))
    const { result, rerender } = renderHook(p => useHA(p), { initialProps: makeParams({ detailTab: 9 }) })

    await waitFor(() => expect(result.current.haLoading).toBe(true))
    rerender(makeParams({ detailTab: 0, selection: { type: 'vm', id: 'conn-1:pve2:lxc:200' } }))
    await act(async () => { failA(new Error('A failed')); await Promise.resolve(); await Promise.resolve() })
    expect(result.current.haError).toBeNull()
  })
})
