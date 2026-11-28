import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { cephPoolsUrl, cephPoolUrl, sendCephTask } from './provisionClient'

/*
   ui#1450: browser side of the provisioning routes. One call that never
   throws and keeps what the server answered: UPID and node, or the error
   with its code and the details the dialogs show.
*/

const fetchMock = vi.fn()
const json = (data: unknown, status = 200) => ({ ok: status < 400, status, json: async () => data })

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe('provision URLs', () => {
  it('encodes the connection and the pool', () => {
    expect(cephPoolsUrl('c 1')).toBe('/api/v1/connections/c%201/ceph/pools')
    expect(cephPoolUrl('c1', 'vm-pool')).toBe('/api/v1/connections/c1/ceph/pools/vm-pool')
    expect(cephPoolUrl('c1', 'vm-pool', { removeStorages: true })).toBe('/api/v1/connections/c1/ceph/pools/vm-pool?removeStorages=1')
  })
})

describe('sendCephTask', () => {
  it('returns the UPID and the node of a started task', async () => {
    fetchMock.mockResolvedValue(json({ data: { upid: 'UPID:pve1:x', node: 'pve1' } }))
    expect(await sendCephTask('/u', 'POST', { a: 1 })).toEqual({ ok: true, status: 200, upid: 'UPID:pve1:x', node: 'pve1' })
    expect(fetchMock).toHaveBeenCalledWith('/u', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"a":1}' })
  })

  it('sends a DELETE without a body', async () => {
    fetchMock.mockResolvedValue(json({ data: { upid: 'U', node: 'pve2' } }))
    await sendCephTask('/u', 'DELETE')
    expect(fetchMock).toHaveBeenCalledWith('/u', { method: 'DELETE' })
  })

  it('keeps the error, the code and the details of a refusal', async () => {
    fetchMock.mockResolvedValue(json({ error: 'The pool still holds guest disks', code: 'POOL_HAS_GUEST_DISKS', disks: ['vm-pool:vm-100-disk-0'] }, 409))
    expect(await sendCephTask('/u', 'DELETE')).toEqual({
      ok: false, status: 409, error: 'The pool still holds guest disks', code: 'POOL_HAS_GUEST_DISKS', disks: ['vm-pool:vm-100-disk-0'],
    })
  })

  it('reports a started task the server could not tie to a PVE task yet', async () => {
    fetchMock.mockResolvedValue(json({ data: { pending: true, node: 'pve1' } }, 202))
    expect(await sendCephTask('/u', 'POST', {})).toEqual({ ok: true, status: 202, pending: true, node: 'pve1' })
  })

  it('never throws on a network error', async () => {
    fetchMock.mockRejectedValue(new Error('Failed to fetch'))
    expect(await sendCephTask('/u', 'POST', {})).toEqual({ ok: false, status: 0, error: 'Failed to fetch' })
  })
})
