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
    expect(fetchSpy).toHaveBeenCalledWith(HA_URL, { cache: 'no-store' })
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
})
