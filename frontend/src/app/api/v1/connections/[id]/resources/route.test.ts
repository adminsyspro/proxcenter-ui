/**
 * GET /api/v1/connections/[id]/resources: a vDC session lists its own guests only, and that subset must not drop
 * the cached configs of the other guests of the connection (the disk totals and the NIC flags the firewall coverage
 * reads, UA46).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { callRoute } from '@/__tests__/setup/route-test'

const h = vi.hoisted(() => ({
  attach: vi.fn(async (..._a: any[]) => undefined),
  visible: new Set<string>(),
}))

const RESOURCES = [
  { type: 'node', node: 'pve1', status: 'online' },
  { type: 'lxc', vmid: 101, node: 'pve1', name: 'a' },
  { type: 'lxc', vmid: 102, node: 'pve1', name: 'b' },
  { type: 'qemu', vmid: 103, node: 'pve1', name: 'c' },
]

vi.mock('@/lib/proxmox/client', () => ({ pveFetch: async () => RESOURCES }))
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionById: async () => ({ id: 'conn-1' }) }))
vi.mock('@/lib/rbac', () => ({
  getRBACContext: async () => ({ isAdmin: true }),
  filterVmsByPermission: async (_u: string, list: any[]) => list,
  checkPermission: async () => null,
  PERMISSIONS: { VM_VIEW: 'vm.view' },
}))
vi.mock('@/lib/vdc/guestGuard', () => ({
  sessionGuestVisibility: async () => ({ ok: true, visibility: { has: (type: string, vmid: number) => h.visible.size === 0 || h.visible.has(`${type}/${vmid}`) } }),
}))
vi.mock('@/lib/inventory/guestDiskTotals', () => ({
  attachGuestDiskTotals: (...a: any[]) => h.attach(...a),
  onlineNodeSet: () => new Set(['pve1']),
}))

import { GET } from './route'

const get = () => callRoute(GET, { params: { id: 'conn-1' } })

beforeEach(() => {
  h.attach.mockClear()
  h.visible.clear()
})

describe('GET /api/v1/connections/[id]/resources: cached guest configs', () => {
  it('says the list is partial for a vDC session, so nothing of the other guests is dropped', async () => {
    h.visible.add('lxc/101')

    const res = await get()

    expect(res.status).toBe(200)
    const [, , guests, opts] = h.attach.mock.calls[0]
    expect(guests).toHaveLength(1)
    expect(opts).toMatchObject({ partial: true, blocking: false })
  })

  it('says the list is complete when every guest is visible', async () => {
    await get()

    const [, , guests, opts] = h.attach.mock.calls[0]
    expect(guests).toHaveLength(3)
    expect(opts).toMatchObject({ partial: false })
  })
})
