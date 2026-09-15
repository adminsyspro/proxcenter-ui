/**
 * MOCK-based tests for the tenant guard on stretched tenant networks (#901):
 * a VNet such a network created belongs to the provider, so the tenant's
 * update and delete refuse it before Proxmox or the database is touched.
 * Run with the unit config (no Postgres):
 *   npx vitest run --config vitest.unit.config.ts src/lib/vdc/vnets.tenantNetworkGuard.test.ts
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { prismaMock, sdnMock, getConnectionByIdMock } = vi.hoisted(() => ({
  prismaMock: {
    vdc: { findFirst: vi.fn() },
    vdcVnet: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn(), delete: vi.fn() },
    vdcSubnet: { update: vi.fn() },
    connection: { findUnique: vi.fn() },
  } as any,
  sdnMock: {
    createVnetPve: vi.fn(), setVnetFirewallEnabled: vi.fn(), deleteVnetPve: vi.fn(), allocateVni: vi.fn(),
    applySdn: vi.fn(), countVnetAttachments: vi.fn(), generatePveVnetId: vi.fn(), listVnetsPve: vi.fn(),
  },
  getConnectionByIdMock: vi.fn(),
}))

vi.mock('@/lib/db/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionById: getConnectionByIdMock }))
vi.mock('./scope', () => ({ clearVdcScopeCache: vi.fn() }))
vi.mock('./sdn', () => sdnMock)
vi.mock('./vlan', () => ({ allocateVlanTag: vi.fn(), ensureVlanZone: vi.fn() }))

import { deleteVnetForTenant, updateVnetForTenant } from './vnets'

const GUARD = 'VNet "backbone" belongs to tenant network "backbone" and is managed by the provider.'

// What findVnetByDisplayName returns for a member VNet: its mirror subnet and
// the membership that points at the network.
const memberRow = {
  id: 'vn1', vdcId: 'v1', pveName: 'v32cf5fc', displayName: 'backbone', tag: 10002, type: 'vxlan', firewall: true,
  subnet: { id: 's-mirror', vnetId: 'vn1', cidr: '10.77.0.0/24', gateway: '10.77.0.1', dnsServers: null, ipamEnabled: true, createdAt: new Date() },
  tenantNetworkMember: { tenantNetwork: { id: 'n1', name: 'backbone', subnet: { id: 's-canon' } } },
  createdBy: null, createdAt: new Date(),
}

beforeEach(() => {
  for (const model of Object.values(prismaMock) as any[]) for (const fn of Object.values(model) as any[]) fn.mockReset()
  for (const fn of Object.values(sdnMock)) fn.mockReset()
  getConnectionByIdMock.mockReset().mockResolvedValue({ id: 'conn' })
  prismaMock.vdc.findFirst.mockResolvedValue({ id: 'v1', tenantId: 't1', connectionId: 'c1', sdnZoneName: 'zacme', enabled: true })
  prismaMock.connection.findUnique.mockResolvedValue({ tenantId: 'default' })
  prismaMock.vdcVnet.findFirst.mockResolvedValue(memberRow)
  prismaMock.vdcVnet.findUnique.mockResolvedValue(memberRow)
  sdnMock.countVnetAttachments.mockResolvedValue(0)
})

describe('a VNet created by a stretched tenant network', () => {
  it('cannot be edited by the tenant: refused before any Proxmox call or row write', async () => {
    await expect(updateVnetForTenant('v1', 't1', 'backbone', { firewall: false, description: 'x', subnet: { dnsServers: ['1.1.1.1'] } })).rejects.toThrow(GUARD)
    expect(sdnMock.setVnetFirewallEnabled).not.toHaveBeenCalled()
    expect(sdnMock.applySdn).not.toHaveBeenCalled()
    expect(prismaMock.vdcVnet.update).not.toHaveBeenCalled()
    expect(prismaMock.vdcSubnet.update).not.toHaveBeenCalled()
  })

  it('cannot be deleted by the tenant: refused before counting attachments or deleting anything', async () => {
    await expect(deleteVnetForTenant('v1', 't1', 'backbone')).rejects.toThrow(GUARD)
    expect(sdnMock.countVnetAttachments).not.toHaveBeenCalled()
    expect(sdnMock.deleteVnetPve).not.toHaveBeenCalled()
    expect(prismaMock.vdcVnet.delete).not.toHaveBeenCalled()
  })

  it('leaves an ordinary VNet of the same vDC editable and deletable', async () => {
    const plain = { ...memberRow, id: 'vn2', displayName: 'lan', pveName: 'v6bc065f', tenantNetworkMember: null }
    prismaMock.vdcVnet.findFirst.mockResolvedValue(plain)
    prismaMock.vdcVnet.findUnique.mockResolvedValue(plain)

    await expect(updateVnetForTenant('v1', 't1', 'lan', { firewall: false })).resolves.toMatchObject({ displayName: 'lan', tenantNetwork: null })
    expect(sdnMock.setVnetFirewallEnabled).toHaveBeenCalledWith({ id: 'conn' }, 'v6bc065f', false)

    await expect(deleteVnetForTenant('v1', 't1', 'lan')).resolves.toEqual({ deleted: true })
    expect(sdnMock.deleteVnetPve).toHaveBeenCalledWith({ id: 'conn' }, 'v6bc065f')
    expect(prismaMock.vdcVnet.delete).toHaveBeenCalledWith({ where: { id: 'vn2' } })
  })
})
