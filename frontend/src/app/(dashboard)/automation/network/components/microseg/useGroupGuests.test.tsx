import React, { type ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, renderHook, waitFor } from '@testing-library/react'
import { SWRConfig } from 'swr'

import { unreadClusterNames, useGroupGuests } from './useGroupGuests'
import { useZoneGuests } from './useZoneGuests'
import { guestId } from './zoneModel'

const fetchMock = vi.fn()
const reply = (status: number, body: unknown) => ({ ok: status < 400, status, text: async () => JSON.stringify(body) })
const vms = (...list: { vmid: number; name: string; type?: string }[]) =>
  ({ data: { vms: list.map(v => ({ vmid: String(v.vmid), name: v.name, node: 'pve1', type: v.type ?? 'qemu', status: 'running', tags: [] })) } })

/** Answers the inventory route of each connection from `byConnection` (a status number fails the read). */
function inventory(byConnection: Record<string, unknown>) {
  fetchMock.mockImplementation(async (url: string) => {
    const conn = new URL(url, 'http://x').searchParams.get('connId') ?? ''
    const answer = byConnection[conn]
    if (typeof answer === 'number') return reply(answer, { error: 'boom' })
    return reply(200, answer ?? vms())
  })
}

const wrapper = ({ children }: { children: ReactNode }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0, errorRetryCount: 0, shouldRetryOnError: false }}>{children}</SWRConfig>
)

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('useGroupGuests', () => {
  it('lists the guests of every cluster, tagged with their connection: two lxc 100 stay two guests', async () => {
    inventory({ 'conn-1': vms({ vmid: 100, name: 'ct-a', type: 'lxc' }), 'conn-2': vms({ vmid: 100, name: 'ct-b', type: 'lxc' }) })
    const { result } = renderHook(() => useGroupGuests(['conn-1', 'conn-2']), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))
    const { guests } = result.current
    expect(guests.map(g => [g.connectionId, g.name])).toEqual([['conn-1', 'ct-a'], ['conn-2', 'ct-b']])
    expect(new Set(guests.map(guestId)).size).toBe(2)
    expect(guests.map(guestId)).toEqual(['conn-1/lxc/100', 'conn-2/lxc/100'])
    expect(result.current.errors).toEqual({})
    expect(result.current.status).toBe('ready')
  })

  it('keeps the guests of the other clusters when one read fails, and says which one failed', async () => {
    inventory({ 'conn-1': vms({ vmid: 100, name: 'ct-a', type: 'lxc' }), 'conn-2': 500 })
    const { result } = renderHook(() => useGroupGuests(['conn-1', 'conn-2']), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.guests.map(g => g.name)).toEqual(['ct-a'])
    expect(Object.keys(result.current.errors)).toEqual(['conn-2'])
    expect(result.current.errors['conn-2']).toBeTruthy()
    expect(result.current.status).toBe('ready')
  })

  // At the lab an unreachable cluster does not fail the inventory read: the route answers 200, no guest, `partial`.
  it('counts a cluster whose inventory listed nothing because its list read failed as unread, on a shared policy', async () => {
    inventory({ 'conn-1': vms({ vmid: 100, name: 'ct-a', type: 'lxc' }), 'conn-2': { data: { vms: [], partial: true } } })
    const { result } = renderHook(() => useGroupGuests(['conn-1', 'conn-2']), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.guests.map(g => g.name)).toEqual(['ct-a'])
    expect(Object.keys(result.current.errors)).toEqual(['conn-2'])
    expect(result.current.status).toBe('ready')
  })

  it('keeps a partial list that still lists guests, and a single cluster with an empty partial list, as read', async () => {
    const partialWithGuests = { data: { vms: vms({ vmid: 100, name: 'ct-b' }).data.vms, partial: true } }
    inventory({ 'conn-1': vms({ vmid: 100, name: 'ct-a' }), 'conn-2': partialWithGuests, 'conn-3': { data: { vms: [], partial: true } } })
    const group = renderHook(() => useGroupGuests(['conn-1', 'conn-2']), { wrapper })
    await waitFor(() => expect(group.result.current.loading).toBe(false))
    expect(group.result.current.errors).toEqual({})
    expect(group.result.current.guests.map(g => g.name)).toEqual(['ct-a', 'ct-b'])
    const single = renderHook(() => useGroupGuests(['conn-3']), { wrapper })
    await waitFor(() => expect(single.result.current.loading).toBe(false))
    expect(single.result.current).toMatchObject({ status: 'ready', errors: {}, guests: [] })
  })

  it('is in error when every cluster failed', async () => {
    inventory({ 'conn-1': 500 })
    const { result } = renderHook(() => useGroupGuests(['conn-1']), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.status).toBe('error')
    expect(result.current.guests).toEqual([])
  })

  it('makes exactly the request of useZoneGuests for a single cluster, and shares its cache', async () => {
    inventory({ 'conn-1': vms({ vmid: 101, name: 'web-1' }) })
    const { result } = renderHook(() => ({ group: useGroupGuests(['conn-1']), one: useZoneGuests('conn-1') }), { wrapper })
    await waitFor(() => expect(result.current.group.loading).toBe(false))
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/vms?connId=conn-1')
    expect(result.current.one.guests.map(guestId)).toEqual(['conn-1/qemu/101'])
    expect(result.current.group.guests.map(guestId)).toEqual(['conn-1/qemu/101'])
  })

  it('hands back the same object and the same reload between renders when nothing changed', async () => {
    inventory({ 'conn-1': vms({ vmid: 100, name: 'a' }), 'conn-2': vms({ vmid: 100, name: 'b' }) })
    const { result, rerender } = renderHook(({ ids }) => useGroupGuests(ids), { wrapper, initialProps: { ids: ['conn-1', 'conn-2'] } })
    await waitFor(() => expect(result.current.loading).toBe(false))
    const before = result.current
    rerender({ ids: ['conn-1', 'conn-2'] })
    expect(result.current).toBe(before)
    expect(result.current.reload).toBe(before.reload)
  })

  it('reads each cluster once, and again on reload', async () => {
    inventory({})
    const { result } = renderHook(() => useGroupGuests(['conn-1', 'conn-2']), { wrapper })
    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(fetchMock.mock.calls.map(c => c[0]).sort()).toEqual(['/api/v1/vms?connId=conn-1', '/api/v1/vms?connId=conn-2'])
    result.current.reload()
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4))
  })
})

describe('unreadClusterNames', () => {
  const names: Record<string, string> = { 'conn-2': 'PVE-DR' }
  const clusterName = (id: string) => names[id] ?? id

  it('names the clusters whose read failed, as the user sees them', () => {
    expect(unreadClusterNames({ 'conn-2': new Error('x') }, clusterName)).toEqual(['PVE-DR'])
  })

  it('names none when one of them has no name the user may see (the lookup gives back the id)', () => {
    expect(unreadClusterNames({ 'conn-2': 1, 'conn-3': 1 }, clusterName)).toBeNull()
    expect(unreadClusterNames({ 'conn-2': 1 })).toBeNull()
  })

  it('is empty when nothing failed', () => {
    expect(unreadClusterNames({}, clusterName)).toEqual([])
  })
})
