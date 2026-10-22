import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/proxmox/client', () => ({ pveFetch: vi.fn() }))
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionById: vi.fn() }))
vi.mock('@/lib/db/prisma', () => ({
  prisma: { vdc: { findMany: vi.fn() } },
}))

import { prisma } from '@/lib/db/prisma'

import { resolveVdcForTenant } from './quota'

const findManyMock = vi.mocked(prisma.vdc.findMany)

const row = (allowBlankVms: boolean | null) => ({
  id: 'v1', pvePoolName: 'vdc-acme', quota: null,
  cpuModelMode: 'unrestricted', cpuAllowedModels: [], cpuDefaultModel: null, cpuAdvancedSettings: true,
  allowBlankVms, nodes: [], storagePolicies: [],
})

beforeEach(() => {
  findManyMock.mockReset()
})

describe('resolveVdcForTenant: blank VM switch (#1171)', () => {
  it('reads the switch from the vDC row', async () => {
    findManyMock.mockResolvedValue([row(true)] as any)
    expect((await resolveVdcForTenant('t1', 'conn-1'))?.allowBlankVms).toBe(true)
    expect(findManyMock.mock.calls[0][0]?.select).toMatchObject({ allowBlankVms: true })
  })

  it('treats a missing value as closed', async () => {
    findManyMock.mockResolvedValue([row(null)] as any)
    expect((await resolveVdcForTenant('t1', 'conn-1'))?.allowBlankVms).toBe(false)
  })
})
