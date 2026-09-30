import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, waitFor, act, cleanup } from '@testing-library/react'

import { useFavorites } from './useFavorites'

const VM = { id: 'x', connId: 'conn-1', node: 'pve1', type: 'qemu', vmid: 100, name: 'web-01' }
const VM_KEY = 'conn-1:pve1:qemu:100'

let fetchSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  fetchSpy = vi.spyOn(global, 'fetch').mockImplementation(async (input: any, init?: any) => {
    if (!init?.method) return { ok: true, json: async () => ({ data: [{ vm_key: 'conn-1:pve2:lxc:200' }] }) } as any

    return { ok: true, json: async () => ({}) } as any
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('useFavorites', () => {
  it('loads the favorites on mount when none are passed as props', async () => {
    const { result } = renderHook(() => useFavorites({}))

    await waitFor(() => expect(result.current.favorites.has('conn-1:pve2:lxc:200')).toBe(true))
    expect(fetchSpy).toHaveBeenCalledWith('/api/v1/favorites', { cache: 'no-store' })
  })

  it('does not load favorites when they come from props', () => {
    const favs = new Set<string>([VM_KEY])
    const { result } = renderHook(() => useFavorites({ propFavorites: favs }))

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(result.current.favorites).toBe(favs)
  })

  it('adds a VM to the local favorites with a POST', async () => {
    const { result } = renderHook(() => useFavorites({}))

    await waitFor(() => expect(result.current.favorites.size).toBe(1))

    act(() => result.current.toggleFavorite(VM))

    await waitFor(() => expect(result.current.favorites.has(VM_KEY)).toBe(true))
    const post = fetchSpy.mock.calls.find(c => (c[1] as any)?.method === 'POST')!
    expect(post[0]).toBe('/api/v1/favorites')
    expect(JSON.parse((post[1] as any).body)).toEqual({
      connectionId: 'conn-1', node: 'pve1', vmType: 'qemu', vmid: '100', vmName: 'web-01',
    })
  })

  it('removes a VM already in the favorites with a DELETE', async () => {
    fetchSpy.mockImplementation(async (input: any, init?: any) => {
      if (!init?.method) return { ok: true, json: async () => ({ data: [{ vm_key: VM_KEY }] }) } as any

      return { ok: true, json: async () => ({}) } as any
    })
    const { result } = renderHook(() => useFavorites({}))

    await waitFor(() => expect(result.current.favorites.has(VM_KEY)).toBe(true))

    act(() => result.current.toggleFavorite(VM))

    await waitFor(() => expect(result.current.favorites.has(VM_KEY)).toBe(false))
    expect(fetchSpy).toHaveBeenCalledWith(`/api/v1/favorites?vmKey=${encodeURIComponent(VM_KEY)}`, { method: 'DELETE' })
  })
})
