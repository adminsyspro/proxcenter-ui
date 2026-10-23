import { beforeEach, describe, expect, it, vi } from 'vitest'

const { getCurrentTenantIdMock, getTenantInfrastructureScopeMock } = vi.hoisted(() => ({
  getCurrentTenantIdMock: vi.fn(),
  getTenantInfrastructureScopeMock: vi.fn(),
}))

vi.mock('@/lib/tenant', () => ({ getCurrentTenantId: getCurrentTenantIdMock }))
vi.mock('@/lib/tenant/infraScope', async () => ({
  ...(await vi.importActual<typeof import('@/lib/tenant/infraScope')>('@/lib/tenant/infraScope')),
  getTenantInfrastructureScope: getTenantInfrastructureScopeMock,
}))

import { keepOwnVnets, keepZonesOf, sdnOwnVnets } from './sdnReadScope'

beforeEach(() => {
  vi.clearAllMocks()
  getCurrentTenantIdMock.mockResolvedValue('tenant-a')
})

describe('sdnOwnVnets', () => {
  it.each([
    { kind: 'provider' },
    { kind: 'msp', connectionIds: new Set(['conn-1']) },
  ])('returns null for the $kind infrastructure scope', async infra => {
    getTenantInfrastructureScopeMock.mockResolvedValue(infra)

    await expect(sdnOwnVnets('conn-1')).resolves.toBeNull()
    expect(getTenantInfrastructureScopeMock).toHaveBeenCalledWith('tenant-a', { ignoreVdcContext: true })
  })

  it('returns the iaas tenant VNets for the requested connection', async () => {
    const own = new Set(['vnet-a', 'vnet-b'])
    getTenantInfrastructureScopeMock.mockResolvedValue({
      kind: 'iaas',
      vdcScope: { vnetsByConnection: new Map([['conn-1', own]]) },
    })

    await expect(sdnOwnVnets('conn-1')).resolves.toBe(own)
  })

  it('returns an empty Set when the iaas tenant has no VNet on the connection', async () => {
    getTenantInfrastructureScopeMock.mockResolvedValue({
      kind: 'iaas',
      vdcScope: { vnetsByConnection: new Map() },
    })

    const result = await sdnOwnVnets('conn-missing')
    expect(result).toEqual(new Set())
    expect(result).not.toBeNull()
  })
})

describe('SDN list filters', () => {
  const vnets = [
    { vnet: 'vnet-a', zone: 'zone-a' },
    { vnet: 'vnet-b', zone: 'zone-b' },
    { vnet: 42, zone: 'zone-a' },
    { zone: 'zone-a' },
  ]

  it('keeps the original VNet list when own is null', () => {
    expect(keepOwnVnets(vnets, null)).toBe(vnets)
  })

  it('keeps only named VNets in the ownership Set', () => {
    expect(keepOwnVnets(vnets, new Set(['vnet-b']))).toEqual([
      { vnet: 'vnet-b', zone: 'zone-b' },
    ])
  })

  it('keeps only zones referenced by the retained VNets', () => {
    const zones = [{ zone: 'zone-a' }, { zone: 'zone-b' }, { zone: 'zone-c' }, { zone: 3 }, {}]

    expect(keepZonesOf(zones, [{ vnet: 'vnet-a', zone: 'zone-a' }, { vnet: 'vnet-b' }])).toEqual([
      { zone: 'zone-a' },
    ])
  })
})
