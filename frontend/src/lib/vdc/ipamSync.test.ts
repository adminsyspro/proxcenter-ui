import { beforeEach, describe, expect, it, vi } from 'vitest'

import { prismaTest, truncate } from '../../__tests__/setup/prisma-test'

import {
  allocateIp,
  findAllocationByMac,
  findAllocationsForVm,
} from './ipam'
import { __clearScanCacheForTests } from './ipamScan'
import { syncIpamForVmConfig } from './ipamSync'

// Stub the IPAM scanner — these tests only care about reconciliation
// logic, not PVE I/O. The real scan path is covered in ipamScan.test.ts.
vi.mock('./ipamScan', async () => {
  const real: any = await vi.importActual('./ipamScan')
  return {
    ...real,
    scanUsedIpsForSubnet: vi.fn(async () => []),
  }
})

// Mock resolveSubnetForBridge so we don't have to seed the full vDC
// hierarchy (zone names, pool names, …) — we already cover that in
// vnets.test.ts. The mocked function is async to match the production
// signature.
vi.mock('./vnets', () => ({
  resolveSubnetForBridge: vi.fn(async (_connectionId: string, bridge: string) => {
    if (bridge === 'tenantA') {
      return {
        vdcId: 'vdc-1',
        vnetId: 'vnet-1',
        subnetId: 'subnet-1',
        pveName: 'tenantA',
        cidr: '10.42.0.0/24',
        gateway: '10.42.0.254',
        dnsServers: [],
        sdnZoneName: 'zoneA',
        pvePoolName: 'poolA',
      }
    }
    if (bridge === 'tenantB') {
      return {
        vdcId: 'vdc-1',
        vnetId: 'vnet-2',
        subnetId: 'subnet-2',
        pveName: 'tenantB',
        cidr: '10.43.0.0/24',
        gateway: '10.43.0.254',
        dnsServers: [],
        sdnZoneName: 'zoneA',
        pvePoolName: 'poolA',
      }
    }
    return null
  }),
}))

const fakeConn = { baseUrl: 'http://x', apiToken: 't' } as any

const TABLES = [
  'vdc_ipam_allocations',
  'vdc_subnets',
  'vdc_vnets',
  'vdcs',
  'provider_connections',
  'Connection',
  'tenants',
]

beforeEach(async () => {
  await truncate(TABLES)
  __clearScanCacheForTests()

  const now = new Date()
  await prismaTest.tenant.create({
    data: { id: 'tenant-1', slug: 'tenant-1', name: 'Test', operatingModel: 'iaas', createdAt: now, updatedAt: now },
  })
  // PVE connections used as vdc.connectionId must be provider-owned and pooled.
  // The deferred pool-sync trigger requires both rows in one transaction.
  await prismaTest.$transaction(async (tx) => {
    await tx.connection.create({
      data: {
        id: 'conn-1',
        tenantId: 'default',
        name: 'pve',
        baseUrl: 'https://pve',
        apiTokenEnc: 'enc',
      },
    })
    await tx.providerConnection.create({ data: { connectionId: 'conn-1' } })
  })
  await prismaTest.vdc.create({
    data: {
      id: 'vdc-1',
      tenantId: 'tenant-1',
      connectionId: 'conn-1',
      name: 'vdc-1',
      slug: 'vdc-1',
      pvePoolName: 'poolA',
    },
  })
  await prismaTest.vdcVnet.createMany({
    data: [
      { id: 'vnet-1', vdcId: 'vdc-1', pveName: 'tenantA', vxlanTag: 10000 },
      { id: 'vnet-2', vdcId: 'vdc-1', pveName: 'tenantB', vxlanTag: 10001 },
    ],
  })
  await prismaTest.vdcSubnet.createMany({
    data: [
      { id: 'subnet-1', vnetId: 'vnet-1', cidr: '10.42.0.0/24', gateway: '10.42.0.254' },
      { id: 'subnet-2', vnetId: 'vnet-2', cidr: '10.43.0.0/24', gateway: '10.43.0.254' },
    ],
  })
})

describe('syncIpamForVmConfig — no-op paths', () => {
  it('returns immediately when neither side has an IPAM-managed bridge', async () => {
    const result = await syncIpamForVmConfig({
      before: { net0: 'virtio=AA:00:00:00:00:01,bridge=vmbr0' },
      after: { net0: 'virtio=AA:00:00:00:00:01,bridge=vmbr1' },
      conn: fakeConn,
      connectionId: 'conn-1',
      vmid: 100,
      hostname: 'test',
    })
    expect(result.bodyOverrides).toEqual({})
  })

  it('returns immediately on a VM without netN slots and no allocations', async () => {
    const result = await syncIpamForVmConfig({
      before: { name: 'foo' },
      after: { name: 'bar' },
      conn: fakeConn,
      connectionId: 'conn-1',
      vmid: 100,
      hostname: null,
    })
    expect(result.bodyOverrides).toEqual({})
  })
})

describe('syncIpamForVmConfig — fresh allocation', () => {
  it('allocates an IP when a NIC moves onto an IPAM-managed VNet', async () => {
    const result = await syncIpamForVmConfig({
      before: null,
      after: { net0: 'virtio=AA:00:00:00:00:01,bridge=tenantA' },
      conn: fakeConn,
      connectionId: 'conn-1',
      vmid: 100,
      hostname: 'web',
    })
    const alloc = await findAllocationByMac('subnet-1', 'AA:00:00:00:00:01')
    expect(alloc?.ip).toBe('10.42.0.1')
    expect(result.bodyOverrides.ipconfig0).toBe('ip=10.42.0.1/24,gw=10.42.0.254')
  })

  it('honours an ipconfigN.ip hint that the caller already set', async () => {
    const result = await syncIpamForVmConfig({
      before: null,
      after: {
        net0: 'virtio=AA:00:00:00:00:01,bridge=tenantA',
        ipconfig0: 'ip=10.42.0.42/24,gw=10.42.0.254',
      },
      conn: fakeConn,
      connectionId: 'conn-1',
      vmid: 100,
      hostname: null,
    })
    const alloc = await findAllocationByMac('subnet-1', 'AA:00:00:00:00:01')
    expect(alloc?.ip).toBe('10.42.0.42')
    expect(result.bodyOverrides).toEqual({})
  })
})

describe('syncIpamForVmConfig — MAC change on the same VNet', () => {
  it('releases the old allocation and creates a new one for the new MAC', async () => {
    await allocateIp({
      vdcId: 'vdc-1',
      subnetId: 'subnet-1',
      vnetId: 'vnet-1',
      connectionId: 'conn-1',
      mac: 'AA:00:00:00:00:01',
      vmid: 100,
      hostname: 'web',
    })
    expect((await findAllocationByMac('subnet-1', 'AA:00:00:00:00:01'))?.ip).toBe('10.42.0.1')

    await syncIpamForVmConfig({
      before: { net0: 'virtio=AA:00:00:00:00:01,bridge=tenantA' },
      after: { net0: 'virtio=BB:00:00:00:00:99,bridge=tenantA' },
      conn: fakeConn,
      connectionId: 'conn-1',
      vmid: 100,
      hostname: 'web',
    })

    expect(await findAllocationByMac('subnet-1', 'AA:00:00:00:00:01')).toBeNull()
    expect(await findAllocationByMac('subnet-1', 'BB:00:00:00:00:99')).not.toBeNull()
  })
})

describe('syncIpamForVmConfig — bridge change between IPAM-managed VNets', () => {
  it('releases in the old subnet and allocates in the new one', async () => {
    await allocateIp({
      vdcId: 'vdc-1',
      subnetId: 'subnet-1',
      vnetId: 'vnet-1',
      connectionId: 'conn-1',
      mac: 'AA:00:00:00:00:01',
      vmid: 100,
    })

    const result = await syncIpamForVmConfig({
      before: { net0: 'virtio=AA:00:00:00:00:01,bridge=tenantA' },
      after: { net0: 'virtio=AA:00:00:00:00:01,bridge=tenantB' },
      conn: fakeConn,
      connectionId: 'conn-1',
      vmid: 100,
      hostname: null,
    })

    expect(await findAllocationByMac('subnet-1', 'AA:00:00:00:00:01')).toBeNull()
    expect((await findAllocationByMac('subnet-2', 'AA:00:00:00:00:01'))?.ip).toBe('10.43.0.1')
    expect(result.bodyOverrides.ipconfig0).toBe('ip=10.43.0.1/24,gw=10.43.0.254')
  })
})

describe('syncIpamForVmConfig — IP change on the same MAC', () => {
  it('honours a new ipconfigN.ip by releasing and re-hinting', async () => {
    await allocateIp({
      vdcId: 'vdc-1',
      subnetId: 'subnet-1',
      vnetId: 'vnet-1',
      connectionId: 'conn-1',
      mac: 'AA:00:00:00:00:01',
      vmid: 100,
    })
    expect((await findAllocationByMac('subnet-1', 'AA:00:00:00:00:01'))?.ip).toBe('10.42.0.1')

    await syncIpamForVmConfig({
      before: {
        net0: 'virtio=AA:00:00:00:00:01,bridge=tenantA',
        ipconfig0: 'ip=10.42.0.1/24,gw=10.42.0.254',
      },
      after: {
        net0: 'virtio=AA:00:00:00:00:01,bridge=tenantA',
        ipconfig0: 'ip=10.42.0.50/24,gw=10.42.0.254',
      },
      conn: fakeConn,
      connectionId: 'conn-1',
      vmid: 100,
      hostname: null,
    })

    expect((await findAllocationByMac('subnet-1', 'AA:00:00:00:00:01'))?.ip).toBe('10.42.0.50')
  })
})

describe('syncIpamForVmConfig — NIC removed from IPAM-managed VNet', () => {
  it('releases the allocation when the bridge moves off an IPAM VNet', async () => {
    await allocateIp({
      vdcId: 'vdc-1',
      subnetId: 'subnet-1',
      vnetId: 'vnet-1',
      connectionId: 'conn-1',
      mac: 'AA:00:00:00:00:01',
      vmid: 100,
    })

    await syncIpamForVmConfig({
      before: { net0: 'virtio=AA:00:00:00:00:01,bridge=tenantA' },
      after: { net0: 'virtio=AA:00:00:00:00:01,bridge=vmbr0' /* unmanaged */ },
      conn: fakeConn,
      connectionId: 'conn-1',
      vmid: 100,
      hostname: null,
    })

    expect(await findAllocationByMac('subnet-1', 'AA:00:00:00:00:01')).toBeNull()
  })
})

describe('syncIpamForVmConfig — rollback on PVE failure simulation', () => {
  it('undo handle restores the released allocation when invoked', async () => {
    await allocateIp({
      vdcId: 'vdc-1',
      subnetId: 'subnet-1',
      vnetId: 'vnet-1',
      connectionId: 'conn-1',
      mac: 'AA:00:00:00:00:01',
      vmid: 100,
      hostname: 'before',
    })

    const result = await syncIpamForVmConfig({
      before: { net0: 'virtio=AA:00:00:00:00:01,bridge=tenantA' },
      after: { net0: 'virtio=BB:00:00:00:00:99,bridge=tenantA' },
      conn: fakeConn,
      connectionId: 'conn-1',
      vmid: 100,
      hostname: 'after',
    })

    expect(await findAllocationByMac('subnet-1', 'AA:00:00:00:00:01')).toBeNull()
    expect(await findAllocationByMac('subnet-1', 'BB:00:00:00:00:99')).not.toBeNull()

    await result.rollback()

    expect(await findAllocationByMac('subnet-1', 'BB:00:00:00:00:99')).toBeNull()
    expect((await findAllocationByMac('subnet-1', 'AA:00:00:00:00:01'))?.ip).toBe('10.42.0.1')
  })
})

describe('syncIpamForVmConfig — unrelated VM, no allocations', () => {
  it('does not leak any allocation when reconfiguring a non-IPAM VM', async () => {
    await syncIpamForVmConfig({
      before: { net0: 'virtio=AA:00:00:00:00:01,bridge=vmbr0' },
      after: { net0: 'virtio=AA:00:00:00:00:01,bridge=vmbr0', cores: 4 },
      conn: fakeConn,
      connectionId: 'conn-1',
      vmid: 100,
      hostname: null,
    })
    expect(await findAllocationsForVm('conn-1', 100)).toEqual([])
  })
})
