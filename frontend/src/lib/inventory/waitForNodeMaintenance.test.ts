import { afterEach, describe, expect, it, vi } from 'vitest'

import { waitForNodeMaintenance } from './waitForNodeMaintenance'

const answer = (maintenance: string | null) =>
  new Response(JSON.stringify({ data: { maintenance } }), { status: 200, headers: { 'Content-Type': 'application/json' } })

describe('waitForNodeMaintenance', () => {
  const fetchMock = vi.fn()
  const sleep = vi.fn(async () => {})

  afterEach(() => {
    fetchMock.mockReset()
    sleep.mockClear()
    vi.unstubAllGlobals()
  })

  it('polls until Proxmox reports the node out of maintenance', async () => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock
      .mockResolvedValueOnce(answer('maintenance'))
      .mockResolvedValueOnce(answer('maintenance'))
      .mockResolvedValueOnce(answer(null))

    await expect(waitForNodeMaintenance('c 1', 'pve3', false, { sleep })).resolves.toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(fetchMock).toHaveBeenCalledWith('/api/v1/connections/c%201/nodes/pve3/maintenance')
    expect(sleep).toHaveBeenCalledTimes(2)
  })

  it('resolves at once when the node already entered maintenance', async () => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock.mockResolvedValueOnce(answer('maintenance'))

    await expect(waitForNodeMaintenance('c1', 'pve3', true, { sleep })).resolves.toBe(true)
    expect(sleep).not.toHaveBeenCalled()
  })

  it('retries through failures and gives up on timeout without throwing', async () => {
    vi.stubGlobal('fetch', fetchMock)
    fetchMock
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(new Response('{}', { status: 500 }))
      .mockResolvedValueOnce(new Response('not json', { status: 200 }))
      .mockImplementation(async () => answer('maintenance'))

    await expect(waitForNodeMaintenance('c1', 'pve3', false, { sleep, timeoutMs: 6_000, intervalMs: 2_000 })).resolves.toBe(false)
    expect(fetchMock).toHaveBeenCalledTimes(4)
    expect(sleep).toHaveBeenCalledTimes(3)
  })
})
