// Creations admitted in parallel must not run past the vDC quota (roadmap#265):
// each admitted creation is reserved until its PVE task ends, and a guest that
// already joined the pool while reserved counts once.

import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/proxmox/client', () => ({ pveFetch: vi.fn() }))
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionById: vi.fn() }))
vi.mock('@/lib/db/prisma', () => ({
  prisma: { connection: { findUnique: vi.fn() } },
}))

import { getConnectionById } from '@/lib/connections/getConnection'
import { prisma } from '@/lib/db/prisma'
import { pveFetch } from '@/lib/proxmox/client'
import { resetGuestDiskTotals } from '@/lib/inventory/guestDiskTotals'

import { checkAndReserveVdcQuota, checkVdcQuota } from './quota'
import { resetVdcQuotaPending } from './quotaPending'

const pveFetchMock = vi.mocked(pveFetch)
const G = 1024 ** 3
const POOL = 'pool-r265'

let members: any[]
let configs: Record<string, any>
let content: any[]

const quota = (over: Partial<Record<'maxVcpus' | 'maxRamMb' | 'maxStorageMb' | 'maxVms', number | null>>) => ({
  maxVcpus: null, maxRamMb: null, maxStorageMb: null, maxVms: null, maxSnapshots: null, maxBackups: null, ...over,
})
const clone = { type: 'clone' as const, addVcpus: 1, addRamMb: 1024, addVms: 1, addStorageMb: 2048 }

beforeEach(() => {
  resetGuestDiskTotals()
  resetVdcQuotaPending()
  members = [{ type: 'qemu', vmid: 100, node: 'pve1', maxdisk: 2 * G, maxcpu: 1, maxmem: G }]
  configs = { '/nodes/pve1/qemu/100/config': { scsi0: 'ceph:vm-100-disk-0,size=2G' } }
  content = [{ content: 'images', vmid: 100, size: 2 * G }]
  vi.mocked(prisma.connection.findUnique).mockReset().mockResolvedValue({ tenantId: 't1' } as any)
  vi.mocked(getConnectionById).mockReset().mockResolvedValue({ id: 'conn-1' } as any)
  pveFetchMock.mockReset().mockImplementation(async (_conn: any, path: any) => {
    if (path === `/pools/${POOL}`) return { members }
    if (path in configs) return configs[path]
    if (path === '/nodes/pve1/storage/ceph/content') return content
    throw new Error(`unexpected pveFetch path: ${path}`)
  })
})

describe('checkAndReserveVdcQuota', () => {
  it('admits one of three parallel creations when one VM slot is left', async () => {
    const results = await Promise.all(['201', '202', '203'].map(vmid =>
      checkAndReserveVdcQuota('conn-1', POOL, quota({ maxVms: 2 }), clone, undefined, 'pve1', vmid)))

    expect(results.map(r => r.allowed)).toEqual([true, false, false])
    expect(results[1].violations[0]).toContain('VMs: 2/2 used')
  })

  it('counts vCPUs, RAM and storage of the creations still running', async () => {
    await checkAndReserveVdcQuota('conn-1', POOL, quota({ maxStorageMb: 5 * 1024 }), clone, undefined, 'pve1', '201')
    const second = await checkAndReserveVdcQuota('conn-1', POOL, quota({ maxStorageMb: 5 * 1024 }), clone, undefined, 'pve1', '202')

    expect(second.allowed).toBe(false)
    expect(second.currentUsage).toMatchObject({ vcpus: 2, ramMb: 2048, storageMb: 4096, vms: 2 })
  })

  it('frees the slot when the reservation is released', async () => {
    const first = await checkAndReserveVdcQuota('conn-1', POOL, quota({ maxVms: 2 }), clone, undefined, 'pve1', '201')
    first.release()
    const second = await checkAndReserveVdcQuota('conn-1', POOL, quota({ maxVms: 2 }), clone, undefined, 'pve1', '202')

    expect(second.allowed).toBe(true)
  })

  it('reserves nothing for a refused creation', async () => {
    const refused = await checkAndReserveVdcQuota('conn-1', POOL, quota({ maxVms: 1 }), clone, undefined, 'pve1', '201')
    expect(refused.allowed).toBe(false)
    refused.release()

    const check = await checkVdcQuota('conn-1', POOL, quota({ maxVms: 2 }), clone)
    expect(check.currentUsage.vms).toBe(1)
  })

  it('counts once a reserved guest that already joined the pool, at its reserved size', async () => {
    await checkAndReserveVdcQuota('conn-1', POOL, quota({ maxVms: 3, maxStorageMb: 100 * 1024 }), clone, undefined, 'pve1', '201')
    // The clone task wrote its config and joined the pool; its disk is still being copied.
    members.push({ type: 'qemu', vmid: 201, node: 'pve1', maxdisk: 0, maxcpu: 1, maxmem: G })
    configs['/nodes/pve1/qemu/201/config'] = {}

    const check = await checkVdcQuota('conn-1', POOL, quota({ maxVms: 3, maxStorageMb: 100 * 1024 }), clone)
    expect(check.currentUsage).toMatchObject({ vcpus: 2, ramMb: 2048, storageMb: 4096, vms: 2 })
  })

  it('never counts an existing guest below its real size because a creation names its VMID', async () => {
    // VM 100 holds 2 GiB. A creation asking for its VMID is reserved until PVE refuses it.
    const tiny = { type: 'clone' as const, addVcpus: 1, addRamMb: 256, addVms: 1, addStorageMb: 512 }
    await checkAndReserveVdcQuota('conn-1', POOL, quota({ maxVms: 5, maxStorageMb: 100 * 1024 }), tiny, undefined, 'pve1', '100')

    const check = await checkVdcQuota('conn-1', POOL, quota({ maxVms: 5, maxStorageMb: 100 * 1024 }), clone)
    expect(check.currentUsage).toMatchObject({ vcpus: 1, ramMb: 1024, storageMb: 2048, vms: 1 })
  })

  it('a plain check sees the reservations too', async () => {
    await checkAndReserveVdcQuota('conn-1', POOL, quota({ maxStorageMb: 5 * 1024 }), clone, undefined, 'pve1', '201')
    const resize = await checkVdcQuota('conn-1', POOL, quota({ maxStorageMb: 5 * 1024 }), { type: 'resize', addStorageMb: 2048 })

    expect(resize.allowed).toBe(false)
  })

  it('meters a storage policy with the reservations on that storage', async () => {
    const policies = [{ policyId: 'p1', name: 'Gold', storageId: 'ceph', quotaMb: 5 * 1024 }]
    const op = { ...clone, addStorageMbByStorage: { ceph: 2048 } }
    const first = await checkAndReserveVdcQuota('conn-1', POOL, null, op, policies, 'pve1', '201')
    const second = await checkAndReserveVdcQuota('conn-1', POOL, null, op, policies, 'pve1', '202')

    expect(first.allowed).toBe(true)
    expect(second.allowed).toBe(false)
    expect(second.violations[0]).toContain('Storage policy "Gold"')
  })

  it('without quota nor policy, admits and reserves nothing', async () => {
    const r = await checkAndReserveVdcQuota('conn-1', POOL, null, clone, undefined, 'pve1', '201')
    expect(r.allowed).toBe(true)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })
})
