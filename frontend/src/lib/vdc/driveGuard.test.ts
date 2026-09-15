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

// Only meterImportRefs/restampGuestDrives call pveFetch; enforceTenantDrives
// itself never touches PVE. Mocked here so those two helpers can be unit
// tested in this same file without a real connection.
const pveFetchMock = vi.fn<(...args: any[]) => Promise<any>>()
vi.mock('@/lib/proxmox/client', () => ({ pveFetch: (...a: any[]) => pveFetchMock(...a) }))

// CD-ROM ownership on ISO libraries (#894) resolves tenant slugs through
// loadTenantSlugs (prisma.tenant.findMany); the caller `t1` is `acme`.
const tenantFindManyMock = vi.fn<(...args: any[]) => Promise<any>>()
vi.mock('@/lib/db/prisma', () => ({
  prisma: { tenant: { findMany: (...a: any[]) => tenantFindManyMock(...a), findUnique: vi.fn() } },
}))

import { DriveScopeError, enforceTenantDrives, meterImportRefs, restampGuestDrives } from './driveGuard'

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
  pveFetchMock.mockReset()
  tenantFindManyMock.mockReset().mockResolvedValue([{ id: 't1', slug: 'acme' }, { id: 't2', slug: 'other' }])
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
    expect(result).toEqual({ addStorageMbByStorage: { 'ceph-nvme': 32768 }, totalAddMb: 32768, importRefs: [] })
  })

  it('iaas: an in-scope volume reference without a policy is left intact, zero metering', async () => {
    getTenantInfrastructureScopeMock.mockResolvedValue(iaasScope(['ceph-nvme', 'ceph-hdd']))
    const body = { scsi1: 'ceph-hdd:vm-100-disk-2,size=32G' }
    const result = await enforceTenantDrives({ tenantId: 't1', connectionId: 'conn-1', type: 'qemu', body })
    expect(body.scsi1).toBe('ceph-hdd:vm-100-disk-2,size=32G')
    expect(result).toEqual({ addStorageMbByStorage: {}, totalAddMb: 0, importRefs: [] })
  })

  it('iaas lxc: mp0 storage is validated but never stamped (LXC has no QoS keys), and metered', async () => {
    getTenantInfrastructureScopeMock.mockResolvedValue(
      iaasScope(['ceph-nvme'], { 'ceph-nvme': gold }),
    )
    const body = { mp0: 'ceph-nvme:8,mp=/data' }
    const result = await enforceTenantDrives({ tenantId: 't1', connectionId: 'conn-1', type: 'lxc', body })
    expect(body.mp0).toBe('ceph-nvme:8,mp=/data')
    expect(result).toEqual({ addStorageMbByStorage: { 'ceph-nvme': 8192 }, totalAddMb: 8192, importRefs: [] })
  })

  it('iaas: efidisk0 is validated and metered but never stamped (aux disk, not a data disk key)', async () => {
    getTenantInfrastructureScopeMock.mockResolvedValue(
      iaasScope(['ceph-nvme'], { 'ceph-nvme': gold }),
    )
    const body = { efidisk0: 'ceph-nvme:1,efitype=4m' }
    const result = await enforceTenantDrives({ tenantId: 't1', connectionId: 'conn-1', type: 'qemu', body })
    expect(body.efidisk0).toBe('ceph-nvme:1,efitype=4m')
    expect(result).toEqual({ addStorageMbByStorage: { 'ceph-nvme': 1024 }, totalAddMb: 1024, importRefs: [] })
  })

  it('iaas: non-disk keys (net0, cores) are ignored', async () => {
    getTenantInfrastructureScopeMock.mockResolvedValue(iaasScope(['ceph-nvme']))
    const body = { net0: 'virtio,bridge=vmbr0', cores: '4' }
    const result = await enforceTenantDrives({ tenantId: 't1', connectionId: 'conn-1', type: 'qemu', body })
    expect(result).toEqual({ addStorageMbByStorage: {}, totalAddMb: 0, importRefs: [] })
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
    expect(result).toEqual({ addStorageMbByStorage: { 'ceph-nvme': 30720 }, totalAddMb: 30720, importRefs: [] })
  })

  it('iaas: a connectionId absent from storagesByConnection denies every storage-bearing key (empty set)', async () => {
    getTenantInfrastructureScopeMock.mockResolvedValue(iaasScope(['ceph-nvme']))
    const body = { scsi0: 'ceph-nvme:32' }
    await expect(
      enforceTenantDrives({ tenantId: 't1', connectionId: 'conn-OTHER', type: 'qemu', body }),
    ).rejects.toThrow(DriveScopeError)
  })

  it('iaas: import-from with a ZERO declared allocation is captured as an importRef, not metered directly (Finding I2)', async () => {
    getTenantInfrastructureScopeMock.mockResolvedValue(iaasScope(['gold']))
    const body = { scsi0: 'gold:0,import-from=gold:vm-100-disk-0' }
    const result = await enforceTenantDrives({ tenantId: 't1', connectionId: 'conn-1', type: 'qemu', body })
    expect(result).toEqual({
      addStorageMbByStorage: {},
      totalAddMb: 0,
      importRefs: [{ key: 'scsi0', targetStorage: 'gold', sourceVolid: 'gold:vm-100-disk-0', declaredMb: 0 }],
    })
  })

  it('iaas: import-from with NO declared allocation (bare volid head) is also captured as an importRef', async () => {
    getTenantInfrastructureScopeMock.mockResolvedValue(iaasScope(['gold']))
    const body = { scsi0: 'gold:vm-100-disk-1,import-from=gold:vm-100-disk-0' }
    const result = await enforceTenantDrives({ tenantId: 't1', connectionId: 'conn-1', type: 'qemu', body })
    expect(result?.importRefs).toEqual([
      { key: 'scsi0', targetStorage: 'gold', sourceVolid: 'gold:vm-100-disk-0', declaredMb: 0 },
    ])
  })

  it('iaas: import-from WITH an explicit non-zero size is metered for the declared part AND still captured as an importRef (residual fix)', async () => {
    getTenantInfrastructureScopeMock.mockResolvedValue(iaasScope(['gold']))
    const body = { scsi0: 'gold:16,import-from=gold:vm-100-disk-0' }
    const result = await enforceTenantDrives({ tenantId: 't1', connectionId: 'conn-1', type: 'qemu', body })
    expect(result).toEqual({
      addStorageMbByStorage: { gold: 16384 },
      totalAddMb: 16384,
      importRefs: [{ key: 'scsi0', targetStorage: 'gold', sourceVolid: 'gold:vm-100-disk-0', declaredMb: 16384 }],
    })
  })

  it('iaas: a plain zero-size volid without import-from produces no importRef', async () => {
    getTenantInfrastructureScopeMock.mockResolvedValue(iaasScope(['gold']))
    const body = { scsi0: 'gold:0' }
    const result = await enforceTenantDrives({ tenantId: 't1', connectionId: 'conn-1', type: 'qemu', body })
    expect(result).toEqual({ addStorageMbByStorage: {}, totalAddMb: 0, importRefs: [] })
  })

  describe('read-only ISO libraries (#894)', () => {
    // Visible = ceph + isolib, writable = ceph only, isolib granted as a library.
    const libScope = () => ({
      kind: 'iaas',
      vdcScope: {
        storagesByConnection: new Map([['conn-1', new Set(['ceph', 'isolib'])]]),
        writableStoragesByConnection: new Map([['conn-1', new Set(['ceph'])]]),
        isoLibrariesByConnection: new Map([['conn-1', new Set(['isolib'])]]),
        storagePoliciesByConnection: new Map([['conn-1', new Map()]]),
      },
    })

    it('a CD/DVD drive on the library passes, unstamped and unmetered', async () => {
      getTenantInfrastructureScopeMock.mockResolvedValue(libScope())
      const body = { ide2: 'isolib:iso/x.iso,media=cdrom' }
      const result = await enforceTenantDrives({ tenantId: 't1', connectionId: 'conn-1', type: 'qemu', body })
      expect(body.ide2).toBe('isolib:iso/x.iso,media=cdrom')
      expect(result).toEqual({ addStorageMbByStorage: {}, totalAddMb: 0, importRefs: [] })
    })

    it("a CD/DVD drive mounting another tenant's upload on the library is refused", async () => {
      getTenantInfrastructureScopeMock.mockResolvedValue(libScope())
      await expect(
        enforceTenantDrives({ tenantId: 't1', connectionId: 'conn-1', type: 'qemu', body: { ide2: 'isolib:iso/custom-other-secret.iso,media=cdrom' } }),
      ).rejects.toThrow(/custom-other-secret\.iso" is not yours to mount/)
      // A custom- file matching no tenant is nobody's either.
      await expect(
        enforceTenantDrives({ tenantId: 't1', connectionId: 'conn-1', type: 'qemu', body: { ide2: 'isolib:iso/custom-nobody-x.iso,media=cdrom' } }),
      ).rejects.toThrow(DriveScopeError)
    })

    it("a CD/DVD drive mounting the tenant's own upload or a provider ISO on the library passes", async () => {
      getTenantInfrastructureScopeMock.mockResolvedValue(libScope())
      const body = { ide2: 'isolib:iso/custom-acme-rescue.iso,media=cdrom', ide3: 'isolib:iso/debian.iso,media=cdrom' }
      const result = await enforceTenantDrives({ tenantId: 't1', connectionId: 'conn-1', type: 'qemu', body })
      expect(result).toEqual({ addStorageMbByStorage: {}, totalAddMb: 0, importRefs: [] })
    })

    it('ownership resolves on the LONGEST slug: acme may not mount custom-acme-prod-x.iso', async () => {
      tenantFindManyMock.mockResolvedValue([{ id: 't1', slug: 'acme' }, { id: 't3', slug: 'acme-prod' }])
      getTenantInfrastructureScopeMock.mockResolvedValue(libScope())
      await expect(
        enforceTenantDrives({ tenantId: 't1', connectionId: 'conn-1', type: 'qemu', body: { ide2: 'isolib:iso/custom-acme-prod-x.iso,media=cdrom' } }),
      ).rejects.toThrow(/not yours to mount/)
    })

    it('the ownership check applies to library storages only: a custom- ISO on the writable storage is not judged', async () => {
      getTenantInfrastructureScopeMock.mockResolvedValue(libScope())
      const body = { ide2: 'ceph:iso/custom-other-x.iso,media=cdrom' }
      await expect(enforceTenantDrives({ tenantId: 't1', connectionId: 'conn-1', type: 'qemu', body })).resolves.toBeTruthy()
      expect(tenantFindManyMock).not.toHaveBeenCalled()
    })

    it('a data disk on the library throws DriveScopeError naming the read-only library', async () => {
      getTenantInfrastructureScopeMock.mockResolvedValue(libScope())
      await expect(
        enforceTenantDrives({ tenantId: 't1', connectionId: 'conn-1', type: 'qemu', body: { scsi1: 'isolib:8' } }),
      ).rejects.toThrow(DriveScopeError)
      await expect(
        enforceTenantDrives({ tenantId: 't1', connectionId: 'conn-1', type: 'qemu', body: { scsi1: 'isolib:8' } }),
      ).rejects.toThrow(/read-only ISO library/)
    })

    it('a data disk on the writable storage next to a library still passes', async () => {
      getTenantInfrastructureScopeMock.mockResolvedValue(libScope())
      const body = { scsi1: 'ceph:8' }
      const result = await enforceTenantDrives({ tenantId: 't1', connectionId: 'conn-1', type: 'qemu', body })
      expect(result).toEqual({ addStorageMbByStorage: { ceph: 8192 }, totalAddMb: 8192, importRefs: [] })
    })

    it('a fixture WITHOUT the two new maps keeps the pre-#894 behaviour: every visible storage is writable', async () => {
      getTenantInfrastructureScopeMock.mockResolvedValue(iaasScope(['ceph', 'isolib']))
      const body = { scsi1: 'isolib:8' }
      const result = await enforceTenantDrives({ tenantId: 't1', connectionId: 'conn-1', type: 'qemu', body })
      expect(result).toEqual({ addStorageMbByStorage: { isolib: 8192 }, totalAddMb: 8192, importRefs: [] })
    })
  })
})

describe('enforceTenantDrives + meterImportRefs combined (Finding I2 residual: declared-size shortcut)', () => {
  const gold32g = [{ volid: 'gold:vm-100-disk-0', size: 32 * 1024 * 1024 * 1024, content: 'images' }]

  it('gold:1,import-from=<32G volid> meters 32768 total for the tier (declared + delta, not double-counted)', async () => {
    getTenantInfrastructureScopeMock.mockResolvedValue(iaasScope(['gold']))
    const body = { scsi0: 'gold:1,import-from=gold:vm-100-disk-0' }
    const result = await enforceTenantDrives({ tenantId: 't1', connectionId: 'conn-1', type: 'qemu', body })
    expect(result?.addStorageMbByStorage).toEqual({ gold: 1024 })

    pveFetchMock.mockResolvedValue(gold32g)
    const imported = await meterImportRefs({ id: 'conn-1' }, 'pve1', result!.importRefs)
    expect(imported).toEqual({ addStorageMbByStorage: { gold: 31744 }, totalAddMb: 31744 })

    const combined = result!.addStorageMbByStorage.gold + imported.addStorageMbByStorage.gold
    expect(combined).toBe(32768)
  })

  it('declared 0 keeps metering the full 32768 (non-regression)', async () => {
    getTenantInfrastructureScopeMock.mockResolvedValue(iaasScope(['gold']))
    const body = { scsi0: 'gold:0,import-from=gold:vm-100-disk-0' }
    const result = await enforceTenantDrives({ tenantId: 't1', connectionId: 'conn-1', type: 'qemu', body })
    expect(result?.addStorageMbByStorage).toEqual({})

    pveFetchMock.mockResolvedValue(gold32g)
    const imported = await meterImportRefs({ id: 'conn-1' }, 'pve1', result!.importRefs)
    expect(imported.addStorageMbByStorage).toEqual({ gold: 32768 })

    const combined = (result!.addStorageMbByStorage.gold ?? 0) + imported.addStorageMbByStorage.gold
    expect(combined).toBe(32768)
  })

  it('a source resolution failure keeps the declared metering (1024) and allows (fail-open unchanged)', async () => {
    getTenantInfrastructureScopeMock.mockResolvedValue(iaasScope(['gold']))
    const body = { scsi0: 'gold:1,import-from=gold:vm-100-disk-0' }
    const result = await enforceTenantDrives({ tenantId: 't1', connectionId: 'conn-1', type: 'qemu', body })
    expect(result?.addStorageMbByStorage).toEqual({ gold: 1024 })

    pveFetchMock.mockRejectedValue(new Error('storage unreachable'))
    const imported = await meterImportRefs({ id: 'conn-1' }, 'pve1', result!.importRefs)
    expect(imported).toEqual({ addStorageMbByStorage: {}, totalAddMb: 0 })

    const combined = result!.addStorageMbByStorage.gold + (imported.addStorageMbByStorage.gold ?? 0)
    expect(combined).toBe(1024)
  })
})

describe('meterImportRefs (Finding I2)', () => {
  const refs = [
    { key: 'scsi0', targetStorage: 'gold', sourceVolid: 'gold:vm-100-disk-0', declaredMb: 0 },
  ]

  it('resolves the source volid size (bytes -> MB) against the target storage', async () => {
    pveFetchMock.mockResolvedValue([
      { volid: 'gold:vm-100-disk-0', size: 32 * 1024 * 1024 * 1024, content: 'images' },
    ])
    const result = await meterImportRefs({ id: 'conn-1' }, 'pve1', refs)
    expect(result).toEqual({ addStorageMbByStorage: { gold: 32768 }, totalAddMb: 32768 })
  })

  it('fetches each DISTINCT source storage only once, even with multiple refs on it', async () => {
    pveFetchMock.mockResolvedValue([
      { volid: 'gold:vm-100-disk-0', size: 8 * 1024 * 1024 * 1024, content: 'images' },
      { volid: 'gold:vm-100-disk-2', size: 4 * 1024 * 1024 * 1024, content: 'images' },
    ])
    const twoRefs = [
      { key: 'scsi0', targetStorage: 'silver', sourceVolid: 'gold:vm-100-disk-0', declaredMb: 0 },
      { key: 'scsi1', targetStorage: 'silver', sourceVolid: 'gold:vm-100-disk-2', declaredMb: 0 },
    ]
    const result = await meterImportRefs({ id: 'conn-1' }, 'pve1', twoRefs)
    expect(result).toEqual({ addStorageMbByStorage: { silver: 12288 }, totalAddMb: 12288 })
    const contentCalls = pveFetchMock.mock.calls.filter((c) => String(c[1]).includes('/storage/gold/content'))
    expect(contentCalls.length).toBe(1)
  })

  it('meters only the delta above declaredMb, never the full source size again', async () => {
    pveFetchMock.mockResolvedValue([
      { volid: 'gold:vm-100-disk-0', size: 8 * 1024 * 1024 * 1024, content: 'images' },
    ])
    const declaredRef = [{ key: 'scsi0', targetStorage: 'gold', sourceVolid: 'gold:vm-100-disk-0', declaredMb: 8192 }]
    const result = await meterImportRefs({ id: 'conn-1' }, 'pve1', declaredRef)
    expect(result).toEqual({ addStorageMbByStorage: {}, totalAddMb: 0 })
  })

  it('a declaredMb larger than the source (should not happen, defensive) never goes negative', async () => {
    pveFetchMock.mockResolvedValue([
      { volid: 'gold:vm-100-disk-0', size: 4 * 1024 * 1024 * 1024, content: 'images' },
    ])
    const overDeclaredRef = [{ key: 'scsi0', targetStorage: 'gold', sourceVolid: 'gold:vm-100-disk-0', declaredMb: 999999 }]
    const result = await meterImportRefs({ id: 'conn-1' }, 'pve1', overDeclaredRef)
    expect(result).toEqual({ addStorageMbByStorage: {}, totalAddMb: 0 })
  })

  it('fail-open: a listing failure is skipped, not thrown', async () => {
    pveFetchMock.mockRejectedValue(new Error('storage unreachable'))
    await expect(meterImportRefs({ id: 'conn-1' }, 'pve1', refs)).resolves.toEqual({
      addStorageMbByStorage: {},
      totalAddMb: 0,
    })
  })

  it('fail-open: an absent volid on the listing is skipped, not thrown', async () => {
    pveFetchMock.mockResolvedValue([{ volid: 'gold:some-other-disk', size: 1024, content: 'images' }])
    await expect(meterImportRefs({ id: 'conn-1' }, 'pve1', refs)).resolves.toEqual({
      addStorageMbByStorage: {},
      totalAddMb: 0,
    })
  })

  it('fail-open: a non-array listing payload is skipped, not thrown (defect 2)', async () => {
    pveFetchMock.mockResolvedValue({ error: 'not an array' } as any)
    await expect(meterImportRefs({ id: 'conn-1' }, 'pve1', refs)).resolves.toEqual({
      addStorageMbByStorage: {},
      totalAddMb: 0,
    })
  })
})

describe('restampGuestDrives (Finding I1)', () => {
  const gold = { policyId: 'p-gold', name: 'Gold', iopsRd: 5000, iopsWr: 4000, mbpsRd: 500, mbpsWr: null }

  it('builds a PUT patch only for DATA disks whose storage carries a policy, and returns the stamped keys', async () => {
    pveFetchMock.mockImplementation(async (_conn: any, _path: string, opts?: any) => {
      if (opts?.method === 'PUT') return null
      return {
        scsi0: 'ceph-nvme:vm-101-disk-0,iops_rd=1',
        scsi1: 'ceph-hdd:vm-101-disk-1,iops_rd=1',
      }
    })
    const policies = new Map([['ceph-nvme', gold]])
    const result = await restampGuestDrives({
      conn: { id: 'conn-1' }, configPath: '/nodes/pve1/qemu/101/config', policies, logTag: '[test-restamp]',
    })

    const putCall = pveFetchMock.mock.calls.find((c) => c[2]?.method === 'PUT')
    expect(putCall).toBeTruthy()
    const patch = new URLSearchParams(String(putCall?.[2]?.body))
    expect(patch.get('scsi0')).toBe('ceph-nvme:vm-101-disk-0,iops_rd=5000,iops_wr=4000,mbps_rd=500')
    expect(patch.has('scsi1')).toBe(false)
    expect(result).toEqual({ stamped: ['scsi0'] })
  })

  it('skips the PUT entirely when nothing would change, and returns an empty stamped array', async () => {
    pveFetchMock.mockImplementation(async (_conn: any, _path: string, opts?: any) => {
      if (opts?.method === 'PUT') return null
      return { scsi0: 'ceph-hdd:vm-101-disk-0' }
    })
    const policies = new Map([['ceph-nvme', gold]])
    const result = await restampGuestDrives({
      conn: { id: 'conn-1' }, configPath: '/nodes/pve1/qemu/101/config', policies, logTag: '[test-restamp]',
    })
    expect(pveFetchMock.mock.calls.some((c) => c[2]?.method === 'PUT')).toBe(false)
    expect(result).toEqual({ stamped: [] })
  })

  it('swallows a GET/PUT failure, never throws, and returns an empty stamped array', async () => {
    pveFetchMock.mockRejectedValue(new Error('PVE unreachable'))
    const policies = new Map([['ceph-nvme', gold]])
    await expect(restampGuestDrives({
      conn: { id: 'conn-1' }, configPath: '/nodes/pve1/qemu/101/config', policies, logTag: '[test-restamp]',
    })).resolves.toEqual({ stamped: [] })
  })
})
