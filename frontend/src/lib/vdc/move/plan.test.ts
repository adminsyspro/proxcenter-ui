import { describe, expect, it } from 'vitest'

import {
  buildPveMapping,
  inspectGuestConfig,
  pickTargetNode,
  restampDriveForTarget,
  sameGuestShape,
  targetRunsMachine,
  validateMoveMapping,
} from './plan'

const CONFIG = {
  name: 'web-01',
  cores: 2,
  sockets: 1,
  memory: 4096,
  cpu: 'x86-64-v2-AES',
  scsi0: 'ceph-gold:vm-105-disk-0,iops_rd=500,size=20G',
  scsi1: 'ceph-gold:vm-105-disk-1,size=10G',
  virtio2: 'ceph-silver:vm-105-disk-2,size=1T',
  efidisk0: 'ceph-gold:vm-105-disk-3,efitype=4m,size=1M',
  ide2: 'none,media=cdrom',
  net0: 'virtio=BC:24:11:00:00:01,bridge=vlan10,firewall=1',
  net1: 'virtio=BC:24:11:00:00:02,bridge=vmbr0,tag=20',
}

describe('inspectGuestConfig', () => {
  it('groups the volumes by source storage with their size', () => {
    const r = inspectGuestConfig(CONFIG)
    expect(r.blockers).toEqual([])
    expect(r.storages).toEqual([
      { storage: 'ceph-gold', disks: ['scsi0', 'scsi1', 'efidisk0'], sizeMb: 20480 + 10240 + 1 },
      { storage: 'ceph-silver', disks: ['virtio2'], sizeMb: 1048576 },
    ])
    expect(r.totalDiskMb).toBe(20480 + 10240 + 1 + 1048576)
  })

  it('groups the NICs by source bridge', () => {
    const r = inspectGuestConfig(CONFIG)
    expect(r.bridges).toEqual([
      { bridge: 'vlan10', nics: ['net0'], tags: [] },
      { bridge: 'vmbr0', nics: ['net1'], tags: [20] },
    ])
  })

  it('reads vCPUs and RAM', () => {
    const r = inspectGuestConfig(CONFIG)
    expect(r.vcpus).toBe(2)
    expect(r.memoryMb).toBe(4096)
    expect(r.cpuModel).toBe('x86-64-v2-AES')
  })

  it('counts vCPUs from vcpus when set, sockets x cores otherwise', () => {
    expect(inspectGuestConfig({ cores: 4, sockets: 2 }).vcpus).toBe(8)
    expect(inspectGuestConfig({ cores: 4, sockets: 2, vcpus: 3 }).vcpus).toBe(3)
    expect(inspectGuestConfig({}).vcpus).toBe(1)
  })

  it('refuses a cloud-init drive', () => {
    const r = inspectGuestConfig({ ...CONFIG, ide3: 'ceph-gold:vm-105-cloudinit,media=cdrom' })
    expect(r.blockers).toContainEqual({ code: 'CLOUD_INIT_DRIVE', context: { key: 'ide3' } })
  })

  it('refuses an inserted CD/DVD medium but ignores an empty drive', () => {
    expect(inspectGuestConfig(CONFIG).blockers).toEqual([])
    const r = inspectGuestConfig({ ...CONFIG, ide2: 'cephfs:iso/debian.iso,media=cdrom' })
    expect(r.blockers).toContainEqual({ code: 'CDROM_INSERTED', context: { key: 'ide2' } })
  })

  it('refuses a passthrough disk and a hostpci device', () => {
    const r = inspectGuestConfig({ ...CONFIG, scsi5: '/dev/disk/by-id/ata-x', hostpci0: '0000:01:00.0' })
    expect(r.blockers).toContainEqual({ code: 'PASSTHROUGH_DEVICE', context: { key: 'scsi5' } })
    expect(r.blockers).toContainEqual({ code: 'PASSTHROUGH_DEVICE', context: { key: 'hostpci0' } })
  })

  it('refuses a USB host device but not a USB tablet spice redirect', () => {
    expect(inspectGuestConfig({ usb0: 'host=1234:5678' }).blockers).toContainEqual({ code: 'PASSTHROUGH_DEVICE', context: { key: 'usb0' } })
    expect(inspectGuestConfig({ usb0: 'spice' }).blockers).toEqual([])
  })

  it('counts unused volumes as volumes to move', () => {
    const r = inspectGuestConfig({ unused0: 'ceph-gold:vm-105-disk-9' })
    expect(r.storages).toEqual([{ storage: 'ceph-gold', disks: ['unused0'], sizeMb: 0 }])
  })
})

describe('validateMoveMapping', () => {
  const inspected = inspectGuestConfig(CONFIG)
  const allowedStorages = new Set(['nvme-gold', 'hdd-silver'])
  const allowedBridges = new Set(['vlan10', 'tnet01'])
  const vlanRanges = new Map<string, Array<[number, number]>>([['tnet01', [[1, 4094]]]])

  it('accepts a full mapping onto storages and networks of the target vDC', () => {
    const r = validateMoveMapping(inspected, {
      storageMap: { 'ceph-gold': 'nvme-gold', 'ceph-silver': 'hdd-silver' },
      bridgeMap: { vlan10: 'vlan10', vmbr0: 'tnet01' },
    }, { allowedStorages, allowedBridges, vlanRanges })
    expect(r).toEqual([])
  })

  it('reports a source storage left without a target', () => {
    const r = validateMoveMapping(inspected, {
      storageMap: { 'ceph-gold': 'nvme-gold' },
      bridgeMap: { vlan10: 'vlan10', vmbr0: 'tnet01' },
    }, { allowedStorages, allowedBridges, vlanRanges })
    expect(r).toEqual([{ code: 'STORAGE_NOT_MAPPED', context: { storage: 'ceph-silver' } }])
  })

  it('refuses a target storage or network outside the target vDC', () => {
    const r = validateMoveMapping(inspected, {
      storageMap: { 'ceph-gold': 'nvme-gold', 'ceph-silver': 'local-lvm' },
      bridgeMap: { vlan10: 'vlan10', vmbr0: 'vmbr0' },
    }, { allowedStorages, allowedBridges })
    expect(r).toEqual([
      { code: 'STORAGE_NOT_IN_TARGET_VDC', context: { storage: 'local-lvm' } },
      { code: 'NETWORK_NOT_IN_TARGET_VDC', context: { bridge: 'vmbr0' } },
    ])
  })

  it('reports a source bridge left without a target', () => {
    const r = validateMoveMapping(inspected, {
      storageMap: { 'ceph-gold': 'nvme-gold', 'ceph-silver': 'hdd-silver' },
      bridgeMap: { vlan10: 'vlan10' },
    }, { allowedStorages, allowedBridges })
    expect(r).toEqual([{ code: 'NETWORK_NOT_MAPPED', context: { bridge: 'vmbr0' } }])
  })

  it('accepts a VLAN tag that a VLAN pool of the target vDC covers on that bridge', () => {
    const r = validateMoveMapping(inspected, {
      storageMap: { 'ceph-gold': 'nvme-gold', 'ceph-silver': 'hdd-silver' },
      bridgeMap: { vlan10: 'vlan10', vmbr0: 'vmbr1' },
    }, { allowedStorages, allowedBridges: new Set(['vlan10', 'vmbr1']), vlanRanges: new Map([['vmbr1', [[10, 30]]]]) })
    expect(r).toEqual([])
  })

  it('refuses a VLAN tag no VLAN pool of the target vDC covers', () => {
    const r = validateMoveMapping(inspected, {
      storageMap: { 'ceph-gold': 'nvme-gold', 'ceph-silver': 'hdd-silver' },
      bridgeMap: { vlan10: 'vlan10', vmbr0: 'vmbr1' },
    }, { allowedStorages, allowedBridges: new Set(['vlan10', 'vmbr1']), vlanRanges: new Map([['vmbr1', [[100, 200]]]]) })
    expect(r).toEqual([{ code: 'VLAN_TAG_NOT_ALLOWED', context: { bridge: 'vmbr1', tag: 20 } }])
  })

  it('refuses a VLAN tag kept on a NIC that lands on a tenant VNet', () => {
    const r = validateMoveMapping(inspected, {
      storageMap: { 'ceph-gold': 'nvme-gold', 'ceph-silver': 'hdd-silver' },
      bridgeMap: { vlan10: 'vlan10', vmbr0: 'tnet01' },
    }, { allowedStorages, allowedBridges, vnetBridges: new Set(['tnet01']) })
    expect(r).toEqual([{ code: 'VLAN_TAG_ON_VNET', context: { bridge: 'tnet01' } }])
  })
})

describe('buildPveMapping', () => {
  it('writes the source:target pairs PVE expects, in a stable order', () => {
    expect(buildPveMapping({ b: 'y', a: 'x' })).toBe('a:x,b:y')
  })

  it('refuses an id PVE would read as a list separator', () => {
    expect(() => buildPveMapping({ 'a,b': 'x' })).toThrow()
    expect(() => buildPveMapping({ a: 'x:y' })).toThrow()
  })
})

describe('restampDriveForTarget', () => {
  const caps = { iopsRd: 1000, iopsWr: null, mbpsRd: 200, mbpsWr: 200 }

  it('replaces the source tier caps with the target tier caps', () => {
    expect(restampDriveForTarget('nvme:vm-1-disk-0,iops_rd=500,size=20G', caps, true))
      .toBe('nvme:vm-1-disk-0,size=20G,iops_rd=1000,mbps_rd=200,mbps_wr=200')
  })

  it('drops the source tier caps when the target storage has no policy', () => {
    expect(restampDriveForTarget('nvme:vm-1-disk-0,iops_rd=500,size=20G', undefined, true))
      .toBe('nvme:vm-1-disk-0,size=20G')
  })

  it('keeps hand-set caps when neither side is policied', () => {
    expect(restampDriveForTarget('nvme:vm-1-disk-0,iops_rd=500,size=20G', undefined, false))
      .toBe('nvme:vm-1-disk-0,iops_rd=500,size=20G')
  })
})

describe('pickTargetNode', () => {
  const nodes = [
    { node: 'a', status: 'online', maxmem: 64 * 1024 ** 3, mem: 60 * 1024 ** 3 },
    { node: 'b', status: 'online', maxmem: 64 * 1024 ** 3, mem: 10 * 1024 ** 3 },
    { node: 'c', status: 'offline', maxmem: 128 * 1024 ** 3, mem: 0 },
    { node: 'd', status: 'online', maxmem: 256 * 1024 ** 3, mem: 0 },
  ]

  it('takes the online authorised node with the most free memory', () => {
    expect(pickTargetNode(nodes, new Set(['a', 'b', 'c']), 4096)).toBe('b')
  })

  it('treats an empty authorised list as every node of the cluster', () => {
    expect(pickTargetNode(nodes, new Set(), 4096)).toBe('d')
  })

  it('answers null when no authorised node can hold the RAM', () => {
    expect(pickTargetNode(nodes, new Set(['a']), 8192)).toBeNull()
  })
})

describe('targetRunsMachine', () => {
  const machines = [
    { id: 'pc-i440fx-11.0', type: 'i440fx', version: '11.0' },
    { id: 'pc-i440fx-11.0+pve0', type: 'i440fx', version: '11.0+pve0' },
    { id: 'pc-q35-11.0', type: 'q35', version: '11.0' },
  ]

  it('accepts a machine version the target QEMU knows', () => {
    expect(targetRunsMachine('pc-i440fx-11.0+pve0', machines)).toBe(true)
    expect(targetRunsMachine('pc-q35-11.0', machines)).toBe(true)
  })

  it('refuses a machine version newer than the target QEMU (the lab case: 11.1 onto 11.0.3)', () => {
    expect(targetRunsMachine('pc-i440fx-11.1+pve0', machines)).toBe(false)
  })

  it('does not block when either side is unknown', () => {
    expect(targetRunsMachine(undefined, machines)).toBe(true)
    expect(targetRunsMachine('pc-i440fx-11.1+pve0', [])).toBe(true)
    expect(targetRunsMachine('pc-i440fx-11.1+pve0', null)).toBe(true)
  })
})

describe('sameGuestShape', () => {
  const checked = inspectGuestConfig(CONFIG)

  it('holds for the same guest, whatever the key order or an unrelated option', () => {
    const reordered = Object.fromEntries(Object.entries(CONFIG).reverse())
    expect(sameGuestShape(checked, inspectGuestConfig({ ...reordered, description: 'edited', onboot: 1 }))).toBe(true)
  })

  it.each([
    ['a NIC added', { net2: 'virtio=BC:24:11:00:00:03,bridge=vmbr1' }],
    ['a NIC moved to another bridge', { net0: 'virtio=BC:24:11:00:00:01,bridge=vmbr1,firewall=1' }],
    ['a VLAN tag changed', { net1: 'virtio=BC:24:11:00:00:02,bridge=vmbr0,tag=30' }],
    ['a disk added on another storage', { scsi3: 'local-lvm:vm-105-disk-9,size=500G' }],
    ['a disk grown', { scsi1: 'ceph-gold:vm-105-disk-1,size=900G' }],
    ['more memory', { memory: 65536 }],
    ['more cores', { cores: 32 }],
    ['another CPU model', { cpu: 'host' }],
  ])('fails on %s', (_label, change) => {
    expect(sameGuestShape(checked, inspectGuestConfig({ ...CONFIG, ...change }))).toBe(false)
  })
})
