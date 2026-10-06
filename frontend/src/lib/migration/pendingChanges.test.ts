import { afterEach, describe, expect, it, vi } from 'vitest'

import { fetchPendingChanges, pendingChangesFromPve } from './pendingChanges'

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('pendingChangesFromPve', () => {
  it('keeps the keys with a pending value or a pending deletion', () => {
    expect(pendingChangesFromPve([
      { key: 'cores', value: 2 },
      { key: 'memory', value: 2048, pending: 4096 },
      { key: 'net1', value: 'virtio,bridge=vmbr1', delete: 1 },
      { key: 'ide2', value: 'none,media=cdrom', delete: 0 },
    ])).toEqual([
      { key: 'memory', value: '2048', pending: '4096' },
      { key: 'net1', value: 'virtio,bridge=vmbr1', delete: true },
    ])
  })

  it('ignores an answer that is not a list and malformed rows', () => {
    expect(pendingChangesFromPve(null)).toEqual([])
    expect(pendingChangesFromPve({ key: 'memory', pending: 1 })).toEqual([])
    expect(pendingChangesFromPve([null, { pending: '1' }])).toEqual([])
  })
})

describe('fetchPendingChanges', () => {
  const guest = { connId: 'conn 1', node: 'pve1', type: 'lxc', vmid: 200 }

  it('reads the route and returns its changes', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ data: { changes: [{ key: 'memory', pending: '1024' }] } })))
    vi.stubGlobal('fetch', fetchMock)

    expect(await fetchPendingChanges(guest)).toEqual([{ key: 'memory', pending: '1024' }])
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/connections/conn%201/guests/lxc/pve1/200/migrate/pending-check', { cache: 'no-store' })
  })

  it('answers unknown (null) on a refusal or a network error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 403 })))
    expect(await fetchPendingChanges(guest)).toBeNull()

    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('offline') }))
    expect(await fetchPendingChanges(guest)).toBeNull()
  })
})
