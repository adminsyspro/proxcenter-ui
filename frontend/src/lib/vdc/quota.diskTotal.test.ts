// The global storage quota of a vDC counts every disk of its pool members
// (#938), read from their configs, not the boot disk `maxdisk` carries.

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

import { checkVdcQuota } from './quota'

const pveFetchMock = vi.mocked(pveFetch)
const G = 1024 ** 3
const POOL = 'pool-i938'

// 104: 20G + 16G, reported as 20G. 9938: 1G + 2G, boot order without a disk,
// reported as 0.
const MEMBERS = [
  { type: 'qemu', vmid: 104, node: 'pve1', maxdisk: 20 * G, maxcpu: 1, maxmem: G },
  { type: 'qemu', vmid: 9938, node: 'pve1', maxdisk: 0, maxcpu: 1, maxmem: G },
]
const CONFIGS: Record<string, any> = {
  '/nodes/pve1/qemu/104/config': { scsi0: 'zfs:vm-104-disk-0,size=20G', scsi1: 'zfs:vm-104-disk-1,size=16G' },
  '/nodes/pve1/qemu/9938/config': { boot: 'order=ide2', scsi0: 'zfs:vm-9938-disk-0,size=1G', scsi1: 'ceph:vm-9938-disk-0,size=2G' },
}

const quota = (maxStorageMb: number | null) => ({
  maxVcpus: null, maxRamMb: null, maxStorageMb,
  maxVms: null, maxSnapshots: null, maxBackups: null,
})

let failConfigs = false

beforeEach(() => {
  resetGuestDiskTotals()
  failConfigs = false
  vi.mocked(prisma.connection.findUnique).mockReset().mockResolvedValue({ tenantId: 't1' } as any)
  vi.mocked(getConnectionById).mockReset().mockResolvedValue({ id: 'conn-1' } as any)
  pveFetchMock.mockReset().mockImplementation(async (_conn: any, path: any) => {
    if (path === `/pools/${POOL}`) return { members: MEMBERS }
    if (path in CONFIGS) {
      if (failConfigs) throw new Error('HTTP 595')
      return CONFIGS[path]
    }
    throw new Error(`unexpected pveFetch path: ${path}`)
  })
})

describe('checkVdcQuota: global storage quota counts every disk (#938)', () => {
  it('refuses a disk that only fits under the boot-disk figure, and reports the real usage', async () => {
    // 39 GiB used for real; maxdisk says 20 GiB. A 10 GiB disk under a 40 GiB quota.
    const result = await checkVdcQuota('conn-1', POOL, quota(40 * 1024), { type: 'create', addStorageMb: 10 * 1024 })

    expect(result.allowed).toBe(false)
    expect(result.currentUsage.storageMb).toBe(39 * 1024)
    expect(result.violations[0]).toContain('Storage: 39.0 GB/40.0 GB used')
  })

  it('still allows what fits', async () => {
    const result = await checkVdcQuota('conn-1', POOL, quota(50 * 1024), { type: 'create', addStorageMb: 10 * 1024 })

    expect(result.allowed).toBe(true)
    expect(result.currentUsage.storageMb).toBe(39 * 1024)
  })

  it('falls back on maxdisk, never 0, and warns when a config cannot be read', async () => {
    failConfigs = true
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const result = await checkVdcQuota('conn-1', POOL, quota(40 * 1024), { type: 'create', addStorageMb: 10 * 1024 })

    expect(result.currentUsage.storageMb).toBe(20 * 1024)
    expect(result.allowed).toBe(true)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('qemu/104'))
    warn.mockRestore()
  })

  it('reads no config when the vDC has no storage quota', async () => {
    const result = await checkVdcQuota('conn-1', POOL, { ...quota(null), maxVcpus: 1 }, { type: 'create', addVcpus: 1 })

    expect(result.allowed).toBe(false)
    expect(pveFetchMock.mock.calls.some(([, path]) => String(path).endsWith('/config'))).toBe(false)
  })
})
