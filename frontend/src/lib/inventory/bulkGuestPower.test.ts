import { describe, expect, it, vi } from 'vitest'

import { bulkPowerSeverity, guestPowerUrl, runBulkGuestPower } from './bulkGuestPower'

const guest = (vmid: number, type = 'qemu') => ({ connId: 'conn 1', node: 'pve/1', type, vmid })

function respond(byVmid: Record<number, number | 'network'>) {
  return vi.fn(async (url: string) => {
    const vmid = Number(url.split('/').at(-2))
    const status = byVmid[vmid] ?? 200
    if (status === 'network') throw new TypeError('Failed to fetch')

    return new Response(JSON.stringify(status < 400 ? { data: 'UPID:x' } : { error: `refused ${vmid}` }), { status })
  })
}

describe('guestPowerUrl', () => {
  it('escapes the connection, the node and the vmid', () => {
    expect(guestPowerUrl(guest(101, 'lxc'), 'start')).toBe('/api/v1/connections/conn%201/guests/lxc/pve%2F1/101/start')
  })
})

describe('runBulkGuestPower', () => {
  it('counts every guest the server accepted', async () => {
    const fetchImpl = respond({})

    expect(await runBulkGuestPower([guest(1), guest(2)], 'start', fetchImpl as unknown as typeof fetch)).toEqual({ success: 2, errors: 0 })
    expect(fetchImpl).toHaveBeenCalledWith('/api/v1/connections/conn%201/guests/qemu/pve%2F1/1/start', { method: 'POST' })
  })

  it('counts HTTP refusals and network failures, keeping the first reason', async () => {
    const fetchImpl = respond({ 2: 403, 3: 'network', 4: 500 })

    expect(await runBulkGuestPower([guest(1), guest(2), guest(3), guest(4)], 'shutdown', fetchImpl as unknown as typeof fetch))
      .toEqual({ success: 1, errors: 3, firstError: 'refused 2' })
  })

  it('sends five guests at a time', async () => {
    let inFlight = 0
    let peak = 0
    const fetchImpl = vi.fn(async () => {
      inFlight++
      peak = Math.max(peak, inFlight)
      await new Promise(r => setTimeout(r, 1))
      inFlight--

      return new Response('{}', { status: 200 })
    })

    await runBulkGuestPower(Array.from({ length: 12 }, (_, i) => guest(i)), 'start', fetchImpl as unknown as typeof fetch)
    expect(fetchImpl).toHaveBeenCalledTimes(12)
    expect(peak).toBe(5)
  })
})

describe('bulkPowerSeverity', () => {
  it('is success, warning or error after how many went through', () => {
    expect(bulkPowerSeverity({ success: 3, errors: 0 })).toBe('success')
    expect(bulkPowerSeverity({ success: 2, errors: 1 })).toBe('warning')
    expect(bulkPowerSeverity({ success: 0, errors: 3 })).toBe('error')
  })
})
