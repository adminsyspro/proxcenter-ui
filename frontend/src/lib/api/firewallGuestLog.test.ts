/**
 * The guest panel's reads of a guest's firewall log: a page newest first (with the count handed back for the later
 * pages) and the lines written since a count (the live mode), both on the guest's own log route.
 */
import { afterEach, describe, expect, it, vi } from 'vitest'

import { getGuestLogAfter, getGuestLogPage } from './firewall'

const GUEST = { node: 'pve 1', type: 'lxc' as const, vmid: 204 }
const PAGE = { total: 3, lines: [{ n: 3, t: 'x' }] }

function stubFetch(body: unknown, status = 200) {
  const fetchMock = vi.fn(async (_url: string) => new Response(JSON.stringify(body), { status }))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

afterEach(() => vi.unstubAllGlobals())

describe('guest log reads', () => {
  it('reads the first page without a count, a later one with it', async () => {
    const fetchMock = stubFetch(PAGE)
    expect(await getGuestLogPage('c 1', GUEST, 0, 20)).toEqual(PAGE)
    await getGuestLogPage('c 1', GUEST, 2, 20, 95)
    expect(fetchMock.mock.calls.map(c => c[0])).toEqual([
      '/api/v1/firewall/vms/c%201/pve%201/lxc/204/log?page=0&size=20',
      '/api/v1/firewall/vms/c%201/pve%201/lxc/204/log?page=2&size=20&total=95',
    ])
  })

  it('reads the lines written since a count', async () => {
    const fetchMock = stubFetch(PAGE)
    expect(await getGuestLogAfter('c1', GUEST, 95, 200)).toEqual(PAGE)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/firewall/vms/c1/pve%201/lxc/204/log?page=0&after=95&size=200')
  })

  it('rejects with the error the route gives', async () => {
    stubFetch({ error: 'Forbidden' }, 403)
    await expect(getGuestLogPage('c1', GUEST, 0, 20)).rejects.toThrow('Forbidden')
  })
})
