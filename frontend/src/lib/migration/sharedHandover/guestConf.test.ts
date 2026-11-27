import { describe, expect, it } from 'vitest'

import { inspectGuestConf, remapGuestConf } from './guestConf'

const QEMU_CONF = `#Web front
#second line
boot: order=scsi0;net0
cores: 2
efidisk0: CephStoragePool:vm-100-disk-1,efitype=4m,size=1M
ide2: local:iso/debian-13.iso,media=cdrom,size=600M
memory: 2048
meta: creation-qemu=11.1.3,ctime=1795760234
net0: virtio=BC:24:11:05:9C:26,bridge=vmbr0,firewall=1
net1: virtio=BC:24:11:05:9C:27,bridge=vlan20,tag=20
parent: before-upgrade
scsi0: CephStoragePool:vm-100-disk-0,iothread=1,size=20G
scsi1: NFS-A:100/vm-100-disk-2.qcow2,size=8G
scsihw: virtio-scsi-single
smbios1: uuid=31fe231a-0a49-4a2a-9ade-90cc34f5111c
tpmstate0: CephStoragePool:vm-100-disk-3,size=4M,version=v2.0
unused0: CephStoragePool:vm-100-disk-4
vmgenid: bf652f9f-54dd-4e81-983a-57d47ac2d122

[before-upgrade]
boot: order=scsi0;net0
memory: 2048
net0: virtio=BC:24:11:05:9C:26,bridge=vmbr0,firewall=1
scsi0: CephStoragePool:vm-100-disk-0,iothread=1,size=20G
snaptime: 1795760000
vmstate: CephStoragePool:vm-100-state-before-upgrade
`

const LXC_CONF = `arch: amd64
hostname: ct-101
memory: 512
mp0: CephStoragePool:vm-101-disk-1,mp=/srv,size=4G
net0: name=eth0,bridge=vmbr0,hwaddr=BC:24:11:00:00:01,ip=dhcp,type=veth
ostype: debian
rootfs: CephStoragePool:vm-101-disk-0,size=8G
`

describe('inspectGuestConf', () => {
  it('lists every disk volume of a VM, snapshot sections and vmstate included', () => {
    const { volumes } = inspectGuestConf(QEMU_CONF, 'qemu')

    expect(volumes.map(v => `${v.section}/${v.key}=${v.volid}`)).toEqual([
      'main/efidisk0=CephStoragePool:vm-100-disk-1',
      'main/scsi0=CephStoragePool:vm-100-disk-0',
      'main/scsi1=NFS-A:100/vm-100-disk-2.qcow2',
      'main/tpmstate0=CephStoragePool:vm-100-disk-3',
      'main/unused0=CephStoragePool:vm-100-disk-4',
      'before-upgrade/scsi0=CephStoragePool:vm-100-disk-0',
      'before-upgrade/vmstate=CephStoragePool:vm-100-state-before-upgrade',
    ])
  })

  it('keeps an ISO apart from the disks: it is detached, not proven', () => {
    const { volumes, isos } = inspectGuestConf(QEMU_CONF, 'qemu')

    expect(volumes.some(v => v.key === 'ide2')).toBe(false)
    expect(isos).toEqual([{ section: 'main', key: 'ide2', storage: 'local', volid: 'local:iso/debian-13.iso' }])
  })

  it('treats a cloud-init drive as a disk of the guest, not as an ISO', () => {
    const { volumes, isos } = inspectGuestConf('ide2: CephStoragePool:vm-100-cloudinit,media=cdrom\n', 'qemu')

    expect(isos).toEqual([])
    expect(volumes).toEqual([
      { section: 'main', key: 'ide2', storage: 'CephStoragePool', volid: 'CephStoragePool:vm-100-cloudinit' },
    ])
  })

  it('names the storages the disks sit on, each once', () => {
    expect(inspectGuestConf(QEMU_CONF, 'qemu').storages).toEqual(['CephStoragePool', 'NFS-A'])
  })

  it('lists the root disk and mount points of a container', () => {
    const { volumes, storages } = inspectGuestConf(LXC_CONF, 'lxc')

    expect(volumes.map(v => `${v.key}=${v.volid}`)).toEqual([
      'mp0=CephStoragePool:vm-101-disk-1',
      'rootfs=CephStoragePool:vm-101-disk-0',
    ])
    expect(storages).toEqual(['CephStoragePool'])
  })

  it('reads a mount point written in its volume= form', () => {
    const { volumes } = inspectGuestConf('mp1: volume=NFS-A:101/vm-101-disk-2.raw,mp=/data\n', 'lxc')

    expect(volumes).toEqual([{ section: 'main', key: 'mp1', storage: 'NFS-A', volid: 'NFS-A:101/vm-101-disk-2.raw' }])
  })

  it('finds no blocker on a portable guest', () => {
    expect(inspectGuestConf(QEMU_CONF, 'qemu').blockers).toEqual([])
    expect(inspectGuestConf(LXC_CONF, 'lxc').blockers).toEqual([])
  })

  it.each([
    ['hostpci0: 0000:01:00.0,pcie=1', 'qemu', 'hostpci0', 'host-device'],
    ['usb0: host=1234:5678', 'qemu', 'usb0', 'host-device'],
    ['usb1: mapping=yubikey', 'qemu', 'usb1', 'host-device'],
    ['serial0: /dev/ttyS0', 'qemu', 'serial0', 'host-device'],
    ['parallel0: /dev/parport0', 'qemu', 'parallel0', 'host-device'],
    ['scsi2: /dev/disk/by-id/ata-SSD,size=100G', 'qemu', 'scsi2', 'passthrough'],
    ['ide0: cdrom,media=cdrom', 'qemu', 'ide0', 'host-device'],
    ['mp2: /mnt/host-data,mp=/data', 'lxc', 'mp2', 'bind-mount'],
    ['dev0: /dev/dri/renderD128,gid=104', 'lxc', 'dev0', 'host-device'],
    ['lxc.mount.entry: /mnt/media mnt/media none bind 0 0', 'lxc', 'lxc.mount.entry', 'bind-mount'],
    ['lock: backup', 'qemu', 'lock', 'locked'],
  ] as const)('blocks %s', (line, type, key, reason) => {
    expect(inspectGuestConf(`memory: 512\n${line}\n`, type).blockers).toEqual([{ section: 'main', key, reason }])
  })

  it('lets a SPICE USB redirection and a serial socket through', () => {
    expect(inspectGuestConf('usb0: spice\nserial0: socket\n', 'qemu').blockers).toEqual([])
  })

  it('skips an empty CD-ROM drive', () => {
    const inspected = inspectGuestConf('ide2: none,media=cdrom\n', 'qemu')

    expect(inspected.volumes).toEqual([])
    expect(inspected.isos).toEqual([])
    expect(inspected.blockers).toEqual([])
  })

  it('reads a pending disk change as a disk of the guest', () => {
    const { volumes } = inspectGuestConf('scsi0: A:vm-100-disk-0\n\n[PENDING]\nscsi1: A:vm-100-disk-1,size=1G\n', 'qemu')

    expect(volumes.map(v => `${v.section}/${v.key}`)).toEqual(['main/scsi0', 'PENDING/scsi1'])
  })
})

describe('remapGuestConf', () => {
  it('moves every disk to its target storage, in every section', () => {
    const { conf } = remapGuestConf(QEMU_CONF, 'qemu', {
      storages: { CephStoragePool: 'SharedCeph', 'NFS-A': 'NFS-B' },
      bridge: 'vmbr1',
    })

    expect(conf).toContain('scsi0: SharedCeph:vm-100-disk-0,iothread=1,size=20G\n')
    expect(conf).toContain('scsi1: NFS-B:100/vm-100-disk-2.qcow2,size=8G\n')
    expect(conf).toContain('efidisk0: SharedCeph:vm-100-disk-1,efitype=4m,size=1M\n')
    expect(conf).toContain('tpmstate0: SharedCeph:vm-100-disk-3,size=4M,version=v2.0\n')
    expect(conf).toContain('unused0: SharedCeph:vm-100-disk-4\n')
    expect(conf).toContain('vmstate: SharedCeph:vm-100-state-before-upgrade\n')
    expect(conf).not.toContain('CephStoragePool:')
  })

  it('puts every NIC on the target bridge and keeps its other options', () => {
    const { conf } = remapGuestConf(QEMU_CONF, 'qemu', { storages: { CephStoragePool: 'X', 'NFS-A': 'Y' }, bridge: 'vmbr1' })

    expect(conf).toContain('net0: virtio=BC:24:11:05:9C:26,bridge=vmbr1,firewall=1\n')
    expect(conf).toContain('net1: virtio=BC:24:11:05:9C:27,bridge=vmbr1,tag=20\n')
  })

  it('detaches an ISO whose storage was not proven and says so', () => {
    const { conf, detachedIsos } = remapGuestConf(QEMU_CONF, 'qemu', { storages: { CephStoragePool: 'X', 'NFS-A': 'Y' }, bridge: 'vmbr0' })

    expect(conf).toContain('ide2: none,media=cdrom\n')
    expect(detachedIsos).toEqual(['local:iso/debian-13.iso'])
  })

  it('keeps everything else byte for byte: identity, description, snapshot metadata', () => {
    const { conf } = remapGuestConf(QEMU_CONF, 'qemu', { storages: { CephStoragePool: 'CephStoragePool', 'NFS-A': 'NFS-A' }, bridge: 'vmbr0' })

    expect(conf).toBe(QEMU_CONF.replace('ide2: local:iso/debian-13.iso,media=cdrom,size=600M', 'ide2: none,media=cdrom').replace('bridge=vlan20', 'bridge=vmbr0'))
  })

  it('remaps a container root disk and a mount point in its volume= form', () => {
    const { conf } = remapGuestConf('rootfs: A:vm-101-disk-0,size=8G\nmp1: volume=A:vm-101-disk-1,mp=/data\n', 'lxc', { storages: { A: 'B' }, bridge: 'vmbr0' })

    expect(conf).toBe('rootfs: B:vm-101-disk-0,size=8G\nmp1: volume=B:vm-101-disk-1,mp=/data\n')
  })

  it('refuses a disk whose storage has no target, instead of writing a guest without it', () => {
    expect(() => remapGuestConf(QEMU_CONF, 'qemu', { storages: { CephStoragePool: 'X' }, bridge: 'vmbr0' }))
      .toThrow(/NFS-A/)
  })
})
