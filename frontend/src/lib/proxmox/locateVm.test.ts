import { describe, it, expect, vi, beforeEach } from 'vitest'

const { pveFetchMock } = vi.hoisted(() => ({ pveFetchMock: vi.fn<(...args: any[]) => Promise<any>>() }))
vi.mock('@/lib/proxmox/client', () => ({ pveFetch: pveFetchMock }))

import { locateVmOrMissing } from './locateVm'

const conn = { baseUrl: 'https://pve', apiToken: 't' } as any

beforeEach(() => {
  pveFetchMock.mockReset()
})

// roadmap#265: an API client takes a 404 as "the guest is gone" and forgets
// it, so "not in the cluster" must never be confused with "could not look".
describe('locateVmOrMissing', () => {
  it('names the node that hosts the guest', async () => {
    pveFetchMock.mockResolvedValue([{ vmid: 121, type: 'qemu', node: 'pve4', status: 'running' }])
    expect(await locateVmOrMissing(conn, '121', 'qemu')).toEqual({ node: 'pve4', status: 'running', name: undefined })
  })

  it('answers missing when the cluster lists no such guest of that type', async () => {
    pveFetchMock.mockResolvedValue([{ vmid: 121, type: 'lxc', node: 'pve4' }])
    expect(await locateVmOrMissing(conn, '121', 'qemu')).toBe('missing')
  })

  it('throws when the cluster cannot be listed, never missing', async () => {
    pveFetchMock.mockRejectedValue(new Error('PVE 595 timeout'))
    await expect(locateVmOrMissing(conn, '121', 'qemu')).rejects.toThrow('595')
  })

  it('throws when the listing is not a list', async () => {
    pveFetchMock.mockResolvedValue({ data: 'unexpected' })
    await expect(locateVmOrMissing(conn, '121', 'qemu')).rejects.toThrow()
  })
})
