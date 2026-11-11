import { beforeEach, describe, expect, it, vi } from 'vitest'

const { pveFetchMock, checkPermissionMock, checkTenantGuestScopeMock } = vi.hoisted(() => ({
  pveFetchMock: vi.fn<(...args: any[]) => Promise<any>>(),
  checkPermissionMock: vi.fn<(...args: any[]) => Promise<Response | null>>(),
  checkTenantGuestScopeMock: vi.fn<(...args: any[]) => Promise<Response | null>>(),
}))

vi.mock('@/lib/proxmox/client', () => ({ pveFetch: pveFetchMock }))
vi.mock('@/lib/rbac', () => ({
  checkPermission: checkPermissionMock,
  buildVmResourceId: (c: string, n: string, t: string, v: string) => `${c}:${n}:${t}:${v}`,
  PERMISSIONS: { VM_CONFIG_HARDWARE: 'vm.config.hardware', STORAGE_CONTENT: 'storage.content' },
}))
vi.mock('@/lib/vdc/guestScope', () => ({ checkTenantGuestScope: checkTenantGuestScopeMock }))

import { cicustomRefusal, foreignVolumeRefusal, referencedVolumes, volumeOwner } from './volumeOwnership'

const denied = () => new Response(JSON.stringify({ error: 'Permission denied' }), { status: 403 })
const conn = { id: 'conn-1' } as any
const base = { connectionId: 'conn-1', conn, tenantId: 'default', type: 'qemu' as const, targetVmid: '100' }
const CLUSTER = [
  { vmid: 100, node: 'pve1', type: 'qemu' },
  { vmid: 200, node: 'pve2', type: 'qemu' },
  { vmid: 300, node: 'pve1', type: 'lxc' },
]

beforeEach(() => {
  pveFetchMock.mockReset().mockResolvedValue(CLUSTER)
  checkPermissionMock.mockReset().mockResolvedValue(null)
  checkTenantGuestScopeMock.mockReset().mockResolvedValue(null)
})

describe('volumeOwner', () => {
  it.each([
    ['local-lvm:vm-200-disk-0', '200'],
    ['ceph:base-9000-disk-1', '9000'],
    ['zfs:subvol-300-disk-0', '300'],
    ['zfs:basevol-300-disk-0', '300'],
    ['local-lvm:vm-200-cloudinit', '200'],
    ['local:200/vm-200-disk-0.qcow2', '200'],
    ['nfs:105/custom-name.raw', '105'],
    // a linked clone lives under its template: the clone is the owner
    ['ceph:base-100-disk-0/vm-105-disk-0', '105'],
    ['zfs:basevol-100-disk-0/subvol-105-disk-0', '105'],
    ['local:100/base-100-disk-0.qcow2/105/vm-105-disk-0.qcow2', '105'],
    ['nfs:1/a.raw/200/custom.raw', '200'],
    // on a directory storage the directory is the owner, whatever the file is called
    ['nfs:200/vm-105-disk-9.raw', '200'],
  ])('%s belongs to guest %s', (volid, owner) => {
    expect(volumeOwner(volid, 'attach')).toEqual({ vmid: owner })
    expect(volumeOwner(volid, 'import')).toEqual({ vmid: owner })
  })

  it.each(['local-lvm:32', 'ceph:0', 'ceph:0.5', 'ceph:cloudinit', 'local:iso/debian-13.iso', 'ISO:iso/vm-200-disk-0.iso'])('%s on a drive is nobody\'s', volid => {
    expect(volumeOwner(volid, 'attach')).toBe('free')
  })

  it('an image of an import directory is free to import from, not to attach', () => {
    expect(volumeOwner('local:import/debian-12.qcow2', 'import')).toBe('free')
    expect(volumeOwner('local:import/debian-12.qcow2', 'attach')).toBe('unknown')
    expect(volumeOwner('local:iso/debian-13.iso', 'import')).toBe('unknown')
    expect(volumeOwner('ceph:32', 'import')).toBe('unknown')
  })

  it.each([
    'local:backup/vzdump-qemu-200-2026_01_01-00_00_00.vma.zst',
    'local:snippets/user.yaml',
    'local:vztmpl/debian-13.tar.zst',
    'san:0.0.1.scsi-36001405abcdef',
    'esxi:ha-datacenter/ds1/app/app.vmdk',
    '/dev/sdb',
    '/mnt/x.qcow2',
    'none',
    '',
  ])('%s is an object no guest can be named for', volid => {
    expect(volumeOwner(volid, 'attach')).toBe('unknown')
    expect(volumeOwner(volid, 'import')).toBe('unknown')
  })
})

describe('referencedVolumes', () => {
  it('reads the attached volume and the import source of a drive line', () => {
    expect(referencedVolumes('ceph:vm-200-disk-0,size=32G,discard=on')).toEqual({ attached: ['ceph:vm-200-disk-0'], importFrom: [] })
    expect(referencedVolumes('ceph:0,import-from=local-lvm:vm-200-disk-0')).toEqual({ attached: ['ceph:0'], importFrom: ['local-lvm:vm-200-disk-0'] })
    expect(referencedVolumes('none,media=cdrom')).toEqual({ attached: [], importFrom: [] })
    expect(referencedVolumes('/dev/disk/by-id/x,size=1G')).toEqual({ attached: [], importFrom: [] })
    expect(referencedVolumes(undefined)).toEqual({ attached: [], importFrom: [] })
  })

  it('reads the explicit key PVE accepts for the volume, wherever it sits in the line', () => {
    expect(referencedVolumes('file=ceph:vm-200-disk-0')).toEqual({ attached: ['ceph:vm-200-disk-0'], importFrom: [] })
    expect(referencedVolumes('discard=on, file=ceph:vm-200-disk-0,size=8G')).toEqual({ attached: ['ceph:vm-200-disk-0'], importFrom: [] })
    expect(referencedVolumes('volume=zfs:subvol-300-disk-1,mp=/data')).toEqual({ attached: ['zfs:subvol-300-disk-1'], importFrom: [] })
    expect(referencedVolumes(' ceph:vm-200-disk-0 , import-from=ceph:vm-201-disk-0,import-from=ceph:vm-202-disk-0')).toEqual({ attached: ['ceph:vm-200-disk-0'], importFrom: ['ceph:vm-201-disk-0', 'ceph:vm-202-disk-0'] })
  })
})

describe('foreignVolumeRefusal', () => {
  it('asks nothing for a body with no existing volume of another guest', async () => {
    const body = {
      scsi0: 'ceph:32',
      scsi1: 'ceph:vm-100-disk-1,size=8G',
      scsi2: 'ceph:0,import-from=local:import/debian-12.qcow2',
      ide2: 'local:iso/debian-13.iso,media=cdrom',
      ide0: 'ceph:cloudinit',
      unused0: 'ceph:vm-100-disk-3',
      net0: 'virtio,bridge=vmbr0',
      description: 'ceph:vm-200-disk-0',
    }
    const currentConfig = { scsi1: 'ceph:vm-100-disk-1,size=4G', unused0: 'ceph:vm-100-disk-3' }

    expect(await foreignVolumeRefusal({ ...base, currentConfig, body })).toBeNull()
    expect(pveFetchMock).not.toHaveBeenCalled()
    expect(checkPermissionMock).not.toHaveBeenCalled()
  })

  it('lets through a volume the guest already carries, whatever its name', async () => {
    const currentConfig = { scsi1: 'ceph:vm-200-disk-0,size=8G', unused0: 'ceph:vm-200-disk-4', digest: 'abc', memory: 2048 }

    expect(await foreignVolumeRefusal({ ...base, currentConfig, body: { scsi1: 'ceph:vm-200-disk-0,size=8G,discard=on', scsi2: 'ceph:vm-200-disk-4' } })).toBeNull()
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('does not take a volume name written in a free-text field for a volume the guest carries', async () => {
    checkPermissionMock.mockResolvedValue(denied())
    const currentConfig = { description: 'ceph:vm-200-disk-0', searchdomain: 'ceph:vm-200-disk-0', ciuser: 'ceph:vm-200-disk-0', net0: 'ceph:vm-200-disk-0' }
    const res = await foreignVolumeRefusal({ ...base, currentConfig, body: { scsi5: 'ceph:vm-200-disk-0' } })

    expect(res?.status).toBe(403)
  })

  it('a volume carrying the guest id is its own only when its configuration carries it', async () => {
    const body = { scsi0: 'ceph:vm-100-disk-0' }

    // re-saving a disk the guest has: nothing asked
    expect(await foreignVolumeRefusal({ ...base, currentConfig: { scsi0: 'ceph:vm-100-disk-0,size=8G' }, body })).toBeNull()
    expect(checkPermissionMock).not.toHaveBeenCalled()

    // on creation, and on an update of a guest that does not have it, the
    // volume was left by an earlier guest of that id: connection-wide grant
    for (const currentConfig of [undefined, { scsi0: 'ceph:vm-100-disk-7', description: 'ceph:vm-100-disk-0' }]) {
      checkPermissionMock.mockReset().mockResolvedValue(null)
      expect(await foreignVolumeRefusal({ ...base, currentConfig, body })).toBeNull()
      expect(checkPermissionMock).toHaveBeenCalledWith('vm.config.hardware', 'connection', 'conn-1')
      expect(pveFetchMock).not.toHaveBeenCalled()

      checkPermissionMock.mockResolvedValue(denied())
      expect((await foreignVolumeRefusal({ ...base, currentConfig, body }))?.status).toBe(403)
      expect((await foreignVolumeRefusal({ ...base, currentConfig, body: { unused3: 'ceph:vm-100-disk-0' } }))?.status).toBe(403)
      expect((await foreignVolumeRefusal({ ...base, currentConfig, body: { scsi4: 'ceph:0,import-from=ceph:vm-100-disk-0' } }))?.status).toBe(403)
      expect((await foreignVolumeRefusal({ ...base, tenantId: 'tenant-1', currentConfig, body }))?.status).toBe(403)
    }
  })

  it('lets a guest copy one of the disks it has', async () => {
    const currentConfig = { scsi0: 'ceph:vm-100-disk-0,size=8G' }

    expect(await foreignVolumeRefusal({ ...base, currentConfig, body: { scsi4: 'ceph:0,import-from=ceph:vm-100-disk-0' } })).toBeNull()
    expect(checkPermissionMock).not.toHaveBeenCalled()
  })

  it('holds an object no guest can be named for to the connection-wide grant', async () => {
    const bodies = [
      { scsi5: 'local:backup/vzdump-qemu-200-2026_01_01-00_00_00.vma.zst' },
      { scsi5: 'ceph:0,import-from=local:backup/vzdump-qemu-200-2026_01_01-00_00_00.vma.zst' },
      { scsi5: 'local:import/x.qcow2' },
      { scsi5: 'san:0.0.1.scsi-36001405abcdef' },
      { scsi5: 'ceph:0,import-from=/mnt/x.qcow2' },
      { scsi5: 'ceph:0,import-from=esxi:ha-datacenter/ds1/app/app.vmdk' },
    ]

    for (const body of bodies) {
      checkPermissionMock.mockReset().mockResolvedValue(null)
      expect(await foreignVolumeRefusal({ ...base, body }), JSON.stringify(body)).toBeNull()
      expect(checkPermissionMock).toHaveBeenCalledWith('vm.config.hardware', 'connection', 'conn-1')
      checkPermissionMock.mockResolvedValue(denied())
      expect((await foreignVolumeRefusal({ ...base, body }))?.status, JSON.stringify(body)).toBe(403)
      expect((await foreignVolumeRefusal({ ...base, tenantId: 'tenant-1', body }))?.status).toBe(403)
    }
  })

  it('on creation a fresh allocation, an ISO and a cloud-init drive still ask nothing', async () => {
    expect(await foreignVolumeRefusal({ ...base, body: { scsi0: 'ceph:32', ide2: 'local:iso/x.iso,media=cdrom', ide0: 'ceph:cloudinit', scsi1: 'ceph:0,import-from=local:import/x.qcow2' } })).toBeNull()
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('still checks an import from another guest, even when that volume is attached here', async () => {
    checkPermissionMock.mockResolvedValue(denied())
    const res = await foreignVolumeRefusal({ ...base, currentConfig: { scsi1: 'ceph:vm-200-disk-0' }, body: { scsi3: 'ceph:0,import-from=ceph:vm-200-disk-0' } })

    expect(res?.status).toBe(403)
  })

  it.each(['scsi5', 'virtio1', 'sata0', 'ide1', 'efidisk0', 'tpmstate0', 'unused7'])('checks the hardware right on the owning guest for %s', async key => {
    expect(await foreignVolumeRefusal({ ...base, body: { [key]: 'ceph:vm-200-disk-0' } })).toBeNull()
    expect(pveFetchMock).toHaveBeenCalledWith(conn, '/cluster/resources?type=vm')
    expect(checkTenantGuestScopeMock).toHaveBeenCalledWith('default', conn, 'conn-1', 'qemu', 'pve2', '200')
    expect(checkPermissionMock).toHaveBeenCalledWith('vm.config.hardware', 'vm', 'conn-1:pve2:qemu:200')
  })

  it('refuses with a 403 naming the key when that right is missing', async () => {
    checkPermissionMock.mockResolvedValue(denied())
    for (const body of [
      { scsi5: 'ceph:vm-200-disk-0' },
      { unused7: 'ceph:vm-200-disk-0' },
      { scsi5: 'ceph:0,import-from=ceph:vm-200-disk-0' },
      { scsi5: 'file=ceph:vm-200-disk-0' },
      { scsi5: 'discard=on,file=ceph:vm-200-disk-0' },
      { scsi5: ' ceph:vm-200-disk-0 ' },
      { scsi5: 'ceph:32,import-from=local:import/x.qcow2,import-from=ceph:vm-200-disk-0' },
    ]) {
      const res = await foreignVolumeRefusal({ ...base, body })
      const key = Object.keys(body)[0]

      expect(res?.status, key).toBe(403)
      expect((await res!.json()).error).toMatch(new RegExp(`^${key}: this volume is not one of this guest's disks`))
    }
  })

  it('refuses a guest outside the tenant before looking at the role', async () => {
    checkTenantGuestScopeMock.mockResolvedValue(denied())
    const res = await foreignVolumeRefusal({ ...base, tenantId: 'tenant-1', body: { scsi5: 'ceph:vm-200-disk-0' } })

    expect(res?.status).toBe(403)
    expect(checkPermissionMock).not.toHaveBeenCalled()
  })

  it('reads container volumes too (rootfs, mount points, unused), with the container as owner type', async () => {
    const lxc = { ...base, type: 'lxc' as const }

    await foreignVolumeRefusal({ ...lxc, body: { mp0: 'zfs:subvol-300-disk-1,mp=/data' } })
    expect(checkPermissionMock).toHaveBeenCalledWith('vm.config.hardware', 'vm', 'conn-1:pve1:lxc:300')
    checkPermissionMock.mockClear()
    await foreignVolumeRefusal({ ...lxc, body: { rootfs: 'zfs:subvol-300-disk-0', unused0: 'zfs:subvol-300-disk-2', mp1: 'volume=zfs:subvol-300-disk-3,mp=/x', scsi0: 'zfs:vm-200-disk-0' } })
    // scsi0 is not a container disk key: only rootfs, unused0 and mp1 are read
    expect(checkPermissionMock).toHaveBeenCalledTimes(3)
  })

  it('a volume whose guest is gone needs a grant on the whole connection, in the provider tenant only', async () => {
    const body = { scsi5: 'ceph:vm-999-disk-0' }

    expect(await foreignVolumeRefusal({ ...base, body })).toBeNull()
    expect(checkPermissionMock).toHaveBeenCalledWith('vm.config.hardware', 'connection', 'conn-1')

    checkPermissionMock.mockResolvedValue(denied())
    expect((await foreignVolumeRefusal({ ...base, body }))?.status).toBe(403)

    checkPermissionMock.mockReset().mockResolvedValue(null)
    expect((await foreignVolumeRefusal({ ...base, tenantId: 'tenant-1', body }))?.status).toBe(403)
    expect(checkPermissionMock).not.toHaveBeenCalled()
  })

  it('treats an unreadable cluster listing as "no such guest"', async () => {
    pveFetchMock.mockResolvedValue(null)
    checkPermissionMock.mockResolvedValue(denied())
    expect((await foreignVolumeRefusal({ ...base, body: { scsi5: 'ceph:vm-200-disk-0' } }))?.status).toBe(403)
  })
})

describe('cicustomRefusal', () => {
  it('lets an empty value through without a check', async () => {
    expect(await cicustomRefusal('conn-1', '')).toBeNull()
    expect(checkPermissionMock).not.toHaveBeenCalled()
  })

  it('checks the content right on every storage named', async () => {
    expect(await cicustomRefusal('conn-1', 'user=local:snippets/user.yaml,network=nfs:snippets/net.yaml,meta=local:snippets/m.yaml,vendor=local:snippets/v.yaml')).toBeNull()
    expect(checkPermissionMock).toHaveBeenCalledWith('storage.content', 'storage', 'conn-1:local')
    expect(checkPermissionMock).toHaveBeenCalledWith('storage.content', 'storage', 'conn-1:nfs')
  })

  it('refuses a storage outside the caller scope with a 403', async () => {
    checkPermissionMock.mockImplementation(async (_p, _t, id) => (id === 'conn-1:nfs' ? denied() : null))
    const res = await cicustomRefusal('conn-1', 'user=local:snippets/user.yaml,network=nfs:snippets/net.yaml')

    expect(res?.status).toBe(403)
    expect(await res!.json()).toEqual({ error: 'cicustom: storage "nfs" is outside your scope.' })
  })

  it.each(['/etc/shadow', 'user=/etc/shadow', 'user=local:snippets/../../x', 'script=local:snippets/x', 'local:snippets/x', 'user=local'])('refuses %s with a 400, unchecked', async value => {
    const res = await cicustomRefusal('conn-1', value)

    expect(res?.status).toBe(400)
    expect(checkPermissionMock).not.toHaveBeenCalled()
  })
})
