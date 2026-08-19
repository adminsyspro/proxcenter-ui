/**
 * Unit tests for the shared `enforceTenantDrives` guard (Task 8). Mocks
 * `@/lib/tenant/infraScope` so the three infra kinds (provider, msp, iaas)
 * can be exercised without a database. Test names match the brief's exact
 * cases (Step 2).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const getTenantInfrastructureScopeMock = vi.fn<(...args: any[]) => Promise<any>>()
vi.mock('@/lib/tenant/infraScope', () => ({
  getTenantInfrastructureScope: (...a: any[]) => getTenantInfrastructureScopeMock(...a),
}))

import { DriveScopeError, enforceTenantDrives } from './driveGuard'

const gold = { policyId: 'p-gold', name: 'Gold', iopsRd: 5000, iopsWr: 4000, mbpsRd: 500, mbpsWr: null }

function iaasScope(storages: string[], policies: Record<string, typeof gold> = {}) {
  return {
    kind: 'iaas',
    vdcScope: {
      storagesByConnection: new Map([['conn-1', new Set(storages)]]),
      storagePoliciesByConnection: new Map([['conn-1', new Map(Object.entries(policies))]]),
    },
  }
}

beforeEach(() => {
  getTenantInfrastructureScopeMock.mockReset()
})

describe('enforceTenantDrives', () => {
  it("kind 'provider': returns null, body untouched (even a tenant mbps=)", async () => {
    getTenantInfrastructureScopeMock.mockResolvedValue({ kind: 'provider' })
    const body = { scsi0: 'local-lvm:32,mbps=9999' }
    const result = await enforceTenantDrives({ tenantId: 't1', connectionId: 'conn-1', type: 'qemu', body })
    expect(result).toBeNull()
    expect(body.scsi0).toBe('local-lvm:32,mbps=9999')
  })

  it("kind 'msp': returns null, body untouched", async () => {
    getTenantInfrastructureScopeMock.mockResolvedValue({ kind: 'msp', connectionIds: new Set(['conn-1']) })
    const body = { scsi0: 'local-lvm:32,mbps=9999' }
    const result = await enforceTenantDrives({ tenantId: 't1', connectionId: 'conn-1', type: 'qemu', body })
    expect(result).toBeNull()
    expect(body.scsi0).toBe('local-lvm:32,mbps=9999')
  })

  it('iaas: an out-of-scope storage throws DriveScopeError naming it', async () => {
    getTenantInfrastructureScopeMock.mockResolvedValue(iaasScope(['ceph-nvme', 'ceph-hdd']))
    const body = { scsi0: 'local-lvm:32' }
    await expect(
      enforceTenantDrives({ tenantId: 't1', connectionId: 'conn-1', type: 'qemu', body }),
    ).rejects.toThrow(DriveScopeError)
    await expect(
      enforceTenantDrives({ tenantId: 't1', connectionId: 'conn-1', type: 'qemu', body }),
    ).rejects.toThrow(/local-lvm/)
  })

  it('iaas: a policied storage is stamped and metered', async () => {
    getTenantInfrastructureScopeMock.mockResolvedValue(
      iaasScope(['ceph-nvme', 'ceph-hdd'], { 'ceph-nvme': gold }),
    )
    const body = { scsi0: 'ceph-nvme:32,iops_rd=99999' }
    const result = await enforceTenantDrives({ tenantId: 't1', connectionId: 'conn-1', type: 'qemu', body })
    expect(body.scsi0).toBe('ceph-nvme:32,iops_rd=5000,iops_wr=4000,mbps_rd=500')
    expect(result).toEqual({ addStorageMbByStorage: { 'ceph-nvme': 32768 }, totalAddMb: 32768 })
  })

  it('iaas: an in-scope volume reference without a policy is left intact, zero metering', async () => {
    getTenantInfrastructureScopeMock.mockResolvedValue(iaasScope(['ceph-nvme', 'ceph-hdd']))
    const body = { scsi1: 'ceph-hdd:vm-100-disk-2,size=32G' }
    const result = await enforceTenantDrives({ tenantId: 't1', connectionId: 'conn-1', type: 'qemu', body })
    expect(body.scsi1).toBe('ceph-hdd:vm-100-disk-2,size=32G')
    expect(result).toEqual({ addStorageMbByStorage: {}, totalAddMb: 0 })
  })

  it('iaas lxc: mp0 storage is validated but never stamped (LXC has no QoS keys), and metered', async () => {
    getTenantInfrastructureScopeMock.mockResolvedValue(
      iaasScope(['ceph-nvme'], { 'ceph-nvme': gold }),
    )
    const body = { mp0: 'ceph-nvme:8,mp=/data' }
    const result = await enforceTenantDrives({ tenantId: 't1', connectionId: 'conn-1', type: 'lxc', body })
    expect(body.mp0).toBe('ceph-nvme:8,mp=/data')
    expect(result).toEqual({ addStorageMbByStorage: { 'ceph-nvme': 8192 }, totalAddMb: 8192 })
  })

  it('iaas: efidisk0 is validated and metered but never stamped (aux disk, not a data disk key)', async () => {
    getTenantInfrastructureScopeMock.mockResolvedValue(
      iaasScope(['ceph-nvme'], { 'ceph-nvme': gold }),
    )
    const body = { efidisk0: 'ceph-nvme:1,efitype=4m' }
    const result = await enforceTenantDrives({ tenantId: 't1', connectionId: 'conn-1', type: 'qemu', body })
    expect(body.efidisk0).toBe('ceph-nvme:1,efitype=4m')
    expect(result).toEqual({ addStorageMbByStorage: { 'ceph-nvme': 1024 }, totalAddMb: 1024 })
  })

  it('iaas: non-disk keys (net0, cores) are ignored', async () => {
    getTenantInfrastructureScopeMock.mockResolvedValue(iaasScope(['ceph-nvme']))
    const body = { net0: 'virtio,bridge=vmbr0', cores: '4' }
    const result = await enforceTenantDrives({ tenantId: 't1', connectionId: 'conn-1', type: 'qemu', body })
    expect(result).toEqual({ addStorageMbByStorage: {}, totalAddMb: 0 })
    expect(body.net0).toBe('virtio,bridge=vmbr0')
    expect(body.cores).toBe('4')
  })

  it('iaas: a spoofed cdrom on a data disk key is still stamped with the storage QoS caps', async () => {
    getTenantInfrastructureScopeMock.mockResolvedValue(
      iaasScope(['ceph-nvme'], { 'ceph-nvme': gold }),
    )
    const body = { scsi0: 'ceph-nvme:vm-100-disk-0,media=cdrom,iops_rd=99999' }
    await enforceTenantDrives({ tenantId: 't1', connectionId: 'conn-1', type: 'qemu', body })
    expect(body.scsi0).toBe('ceph-nvme:vm-100-disk-0,media=cdrom,iops_rd=5000,iops_wr=4000,mbps_rd=500')
  })

  it('iaas: a lxc unusedN key is validated against scope (the config route forwards it, so it must be too)', async () => {
    getTenantInfrastructureScopeMock.mockResolvedValue(iaasScope(['ceph-nvme']))
    const body = { unused0: 'local-lvm:vm-100-disk-3' }
    await expect(
      enforceTenantDrives({ tenantId: 't1', connectionId: 'conn-1', type: 'lxc', body }),
    ).rejects.toThrow(/local-lvm/)
  })

  it('iaas: a null vdcScope (should not happen post-contract-fix) throws rather than fail-open', async () => {
    getTenantInfrastructureScopeMock.mockResolvedValue({ kind: 'iaas', vdcScope: null })
    const body = { scsi0: 'ceph-nvme:32' }
    await expect(
      enforceTenantDrives({ tenantId: 't1', connectionId: 'conn-1', type: 'qemu', body }),
    ).rejects.toThrow(DriveScopeError)
  })

  it('iaas: two disks on the same policied storage accumulate their metering', async () => {
    getTenantInfrastructureScopeMock.mockResolvedValue(
      iaasScope(['ceph-nvme'], { 'ceph-nvme': gold }),
    )
    const body = { scsi0: 'ceph-nvme:10', scsi1: 'ceph-nvme:20' }
    const result = await enforceTenantDrives({ tenantId: 't1', connectionId: 'conn-1', type: 'qemu', body })
    expect(result).toEqual({ addStorageMbByStorage: { 'ceph-nvme': 30720 }, totalAddMb: 30720 })
  })

  it('iaas: a connectionId absent from storagesByConnection denies every storage-bearing key (empty set)', async () => {
    getTenantInfrastructureScopeMock.mockResolvedValue(iaasScope(['ceph-nvme']))
    const body = { scsi0: 'ceph-nvme:32' }
    await expect(
      enforceTenantDrives({ tenantId: 't1', connectionId: 'conn-OTHER', type: 'qemu', body }),
    ).rejects.toThrow(DriveScopeError)
  })
})
