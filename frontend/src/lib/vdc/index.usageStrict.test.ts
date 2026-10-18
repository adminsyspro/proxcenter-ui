/**
 * `refreshVdcUsage(id, { strict: true })` (#902): the scheduled sampler must
 * not record a vDC as empty because its cluster did not answer. Without the
 * option, the on-demand refresh keeps counting zero as before.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { prismaTest, truncate } from '../../__tests__/setup/prisma-test'

const { pveFetchMock } = vi.hoisted(() => ({ pveFetchMock: vi.fn<(...args: any[]) => Promise<any>>() }))

vi.mock('@/lib/proxmox/client', () => ({ pveFetch: (...a: any[]) => pveFetchMock(...a) }))
vi.mock('@/lib/proxmox/pbs-client', () => ({ pbsFetch: vi.fn() }))
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionById: vi.fn(async () => ({ id: 'conn1' })) }))

import { refreshVdcUsage } from './index'

beforeEach(async () => {
  pveFetchMock.mockReset()
  await truncate(['vdc_usage_cache', 'vdcs', 'provider_connections', 'Connection', 'tenants'])
  const now = new Date()

  await prismaTest.tenant.create({
    data: { id: 'tenant-1', slug: 'tenant-1', name: 'Test', operatingModel: 'iaas', createdAt: now, updatedAt: now },
  })
  await prismaTest.$transaction(async (tx) => {
    await tx.connection.create({ data: { id: 'conn1', tenantId: 'default', name: 'pve', baseUrl: 'https://pve', apiTokenEnc: 'enc' } })
    await tx.providerConnection.create({ data: { connectionId: 'conn1' } })
  })
  await prismaTest.vdc.create({
    data: { id: 'vdc-1', tenantId: 'tenant-1', connectionId: 'conn1', name: 'ACME', slug: 'acme', pvePoolName: 'pool-vdc-1' },
  })
  pveFetchMock.mockRejectedValue(new Error('connect ETIMEDOUT'))
})

describe('refreshVdcUsage: strict mode (#902)', () => {
  it('throws and leaves the cache alone when the pool cannot be read', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(refreshVdcUsage('vdc-1', { strict: true })).rejects.toThrow('ETIMEDOUT')
    expect(await prismaTest.vdcUsageCache.count()).toBe(0)
  })

  it('still counts zero for an on-demand refresh', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {})

    const usage = await refreshVdcUsage('vdc-1')

    expect(usage).toMatchObject({ usedVms: 0, usedStorageMb: 0 })
    expect(await prismaTest.vdcUsageCache.count()).toBe(1)
  })
})
