/**
 * `refreshVdcUsage` (the usage shown in My vDC and the vDC panels) counts
 * every disk of the pool members, read from their configs (#938). Same
 * Postgres-backed setup as index.usageByStorage.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { prismaTest, truncate } from '../../__tests__/setup/prisma-test'

const { pveFetchMock, getConnectionByIdMock } = vi.hoisted(() => ({
  pveFetchMock: vi.fn<(...args: any[]) => Promise<any>>(),
  getConnectionByIdMock: vi.fn(async () => ({ id: 'conn1' })),
}))
vi.mock('@/lib/proxmox/client', () => ({ pveFetch: (...a: any[]) => pveFetchMock(...a) }))
vi.mock('@/lib/proxmox/pbs-client', () => ({ pbsFetch: vi.fn() }))
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionById: getConnectionByIdMock }))

import { refreshVdcUsage } from './index'
import { resetGuestDiskTotals } from '@/lib/inventory/guestDiskTotals'

const TABLES = [
  'vdc_storage_policies', 'storage_policies', 'vdc_usage_cache',
  'vdc_pbs_namespaces', 'vdcs', 'provider_connections', 'Connection', 'tenants',
]

beforeEach(async () => {
  pveFetchMock.mockReset()
  resetGuestDiskTotals()
  getConnectionByIdMock.mockClear()
  await truncate(TABLES)

  const now = new Date()
  await prismaTest.tenant.create({
    data: { id: 'tenant-1', slug: 'tenant-1', name: 'Test', operatingModel: 'iaas', createdAt: now, updatedAt: now },
  })
  await prismaTest.$transaction(async (tx) => {
    await tx.connection.create({
      data: { id: 'conn1', tenantId: 'default', name: 'pve-1', baseUrl: 'https://pve1', apiTokenEnc: 'enc' },
    })
    await tx.providerConnection.create({ data: { connectionId: 'conn1' } })
  })

  await prismaTest.vdc.create({
    data: {
      id: 'vdc-1',
      tenantId: 'tenant-1',
      connectionId: 'conn1',
      name: 'ACME',
      slug: 'acme',
      pvePoolName: 'pool-vdc-1',
    },
  })
})

const G = 1024 ** 3

describe('refreshVdcUsage: usedStorageMb counts every disk (#938)', () => {
  it('sums the configs of the pool members, a VM reported with maxdisk 0 included', async () => {
    const members = [
      { vmid: 104, type: 'qemu', node: 'pve1', maxdisk: 20 * G },
      { vmid: 9938, type: 'qemu', node: 'pve1', maxdisk: 0 },
      { vmid: 200, type: 'lxc', node: 'pve1', maxdisk: 8 * G },
    ]
    const configs: Record<string, any> = {
      '/nodes/pve1/qemu/104/config': { scsi0: 'z:vm-104-disk-0,size=20G', scsi1: 'z:vm-104-disk-1,size=16G' },
      '/nodes/pve1/qemu/9938/config': { boot: 'order=ide2', scsi0: 'z:vm-9938-disk-0,size=1G', scsi1: 'c:vm-9938-disk-0,size=2G' },
    }
    pveFetchMock.mockImplementation(async (_conn: any, path: string) => {
      if (path.startsWith('/pools/')) return { members }
      if (path === '/cluster/resources?type=vm') return members.map(m => ({ type: m.type, vmid: m.vmid }))
      if (path in configs) return configs[path]
      if (path === '/nodes/pve1/lxc/200/config') throw new Error('HTTP 595')
      return []
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    const usage = await refreshVdcUsage('vdc-1')

    // 36 GiB + 3 GiB from the configs, 8 GiB of maxdisk for the unreadable container.
    expect(usage.usedStorageMb).toBe((36 + 3 + 8) * 1024)
    const cached = await prismaTest.vdcUsageCache.findUnique({ where: { vdcId: 'vdc-1' } })
    expect(cached?.usedStorageMb).toBe((36 + 3 + 8) * 1024)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('lxc/200'))
    warn.mockRestore()
  })
})
