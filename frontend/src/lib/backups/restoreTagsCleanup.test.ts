import { beforeEach, describe, expect, it, vi } from 'vitest'

const { pveFetchMock } = vi.hoisted(() => ({ pveFetchMock: vi.fn() }))
vi.mock('@/lib/proxmox/client', () => ({ pveFetch: pveFetchMock }))

import { clearRestoredTags } from './restoreTagsCleanup'

const conn = { id: 'pve-1' } as any
const args = { conn, node: 'pve1', isLxc: false, vmid: 9967 }

beforeEach(() => {
  pveFetchMock.mockReset()
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

const puts = () => pveFetchMock.mock.calls.filter(c => c[2]?.method === 'PUT')

describe('clearRestoredTags', () => {
  it('deletes the blank tags line the empty override leaves', async () => {
    pveFetchMock.mockResolvedValueOnce({ name: 'vm', tags: ' ' }).mockResolvedValueOnce(null)

    expect(await clearRestoredTags(args)).toBe('cleared')
    expect(pveFetchMock.mock.calls[0][1]).toBe('/nodes/pve1/qemu/9967/config')
    expect(puts()).toHaveLength(1)
    expect(new URLSearchParams(puts()[0][2].body).get('delete')).toBe('tags')
  })

  it('removes real tags a PVE kept despite the override, and logs it', async () => {
    pveFetchMock.mockResolvedValueOnce({ tags: 'prod;proxcenter-replica' }).mockResolvedValueOnce(null)

    expect(await clearRestoredTags({ ...args, isLxc: true })).toBe('cleared')
    expect(puts()[0][1]).toBe('/nodes/pve1/lxc/9967/config')
    expect(console.error).toHaveBeenCalled()
  })

  it('leaves a guest without a tags line alone', async () => {
    pveFetchMock.mockResolvedValueOnce({ name: 'vm' })
    expect(await clearRestoredTags(args)).toBe('absent')
    expect(puts()).toHaveLength(0)
  })

  it('does not edit a guest still locked by the restore', async () => {
    pveFetchMock.mockResolvedValueOnce({ tags: ' ', lock: 'create' })
    expect(await clearRestoredTags(args)).toBe('locked')
    expect(puts()).toHaveLength(0)
  })

  it('tells a restore that never wrote a config from a read error', async () => {
    pveFetchMock.mockRejectedValueOnce(new Error("Configuration file 'nodes/pve1/qemu-server/9967.conf' does not exist"))
    expect(await clearRestoredTags(args)).toBe('missing')

    pveFetchMock.mockRejectedValueOnce(new Error('500 timeout'))
    expect(await clearRestoredTags(args)).toBe('failed')
  })

  it('reports a refused edit as failed', async () => {
    pveFetchMock.mockResolvedValueOnce({ tags: ' ' }).mockRejectedValueOnce(new Error('403'))
    expect(await clearRestoredTags(args)).toBe('failed')
  })
})
