import { describe, expect, it } from 'vitest'

import { describeChange, describeGrouped, describeSpec, netFields, parseSize } from './describe'

const fmt = { bytes: (n: number) => `${n / 1024 ** 3}G` }
const d = (field: string, oldValue: string, newValue: string) => ({ field, oldValue, newValue })

describe('parseSize', () => {
  it('reads Proxmox sizes as bytes', () => {
    expect(parseSize('25G')).toBe(25 * 1024 ** 3)
    expect(parseSize('512M')).toBe(512 * 1024 ** 2)
    expect(parseSize('2406K')).toBe(2406 * 1024)
    expect(parseSize('1.5T')).toBe(1.5 * 1024 ** 4)
    expect(parseSize('42')).toBe(42)
    expect(parseSize('big')).toBeUndefined()
    expect(parseSize(undefined)).toBeUndefined()
  })
})

describe('describeChange', () => {
  it('reads memory in bytes and cores as they are', () => {
    expect(describeChange([d('memory', '2048', '4096'), d('cores', '2', '4')], fmt)).toEqual([
      { kind: 'changed', label: { key: 'memory' }, from: '2G', to: '4G' },
      { kind: 'changed', label: { key: 'cores' }, from: '2', to: '4' }
    ])
  })

  it('hides identity stamps and reads a new ctime as a re-creation, first', () => {
    const facts = describeChange([
      d('boot', 'order=scsi0', 'order=net0'),
      d('meta', 'creation-qemu=11.0.3,ctime=1', 'creation-qemu=11.0.3,ctime=2'),
      d('vmgenid', 'a', 'b'),
      d('smbios1', 'uuid=a', 'uuid=b')
    ], fmt)

    expect(facts).toEqual([
      { kind: 'recreated' },
      { kind: 'changed', label: { key: 'boot' }, from: 'scsi0', to: 'net0' }
    ])
  })

  it('keeps a meta without ctime change silent', () => {
    expect(describeChange([d('meta', 'creation-qemu=11.0.3,ctime=1', 'creation-qemu=11.0.4,ctime=1')], fmt)).toEqual([])
  })

  it('reads an added and a removed disk with size and storage', () => {
    expect(describeChange([d('scsi1', '', 'Ceph:vm-1-disk-1,size=32G')], fmt)).toEqual([
      { kind: 'added', label: { text: 'scsi1' }, value: '32G · Ceph' }
    ])
    expect(describeChange([d('efidisk0', 'Ceph:vm-1-disk-0,efitype=4m', '')], fmt)).toEqual([
      { kind: 'removed', label: { text: 'efidisk0' }, value: 'Ceph' }
    ])
  })

  it('reads a disk move and a resize, and a mere volume rename as modified', () => {
    expect(describeChange([d('scsi0', 'local-lvm:vm-1-disk-0,size=10G', 'Ceph:vm-1-disk-0,size=15G')], fmt)).toEqual([
      { kind: 'changed', label: { key: 'storage', of: 'scsi0' }, from: 'local-lvm', to: 'Ceph' },
      { kind: 'changed', label: { key: 'size', of: 'scsi0' }, from: '10G', to: '15G' }
    ])
    expect(describeChange([d('scsi0', 'Z:vm-114-disk-0,size=3G', 'Z:vm-122-disk-0,size=3G')], fmt)).toEqual([
      { kind: 'modified', label: { text: 'scsi0' } }
    ])
  })

  it('reads a cdrom by its iso', () => {
    expect(describeChange([d('ide2', 'local:iso/a.iso,media=cdrom', 'local:iso/b.iso,media=cdrom')], fmt)).toEqual([
      { kind: 'changed', label: { text: 'ide2' }, from: 'a.iso', to: 'b.iso' }
    ])
    expect(describeChange([d('ide2', 'local:iso/a.iso,media=cdrom', 'none,media=cdrom')], fmt)).toEqual([
      { kind: 'removed', label: { text: 'ide2' }, value: 'a.iso' }
    ])
    expect(describeChange([d('ide2', 'none,media=cdrom', 'local:iso/b.iso,media=cdrom')], fmt)).toEqual([
      { kind: 'added', label: { text: 'ide2' }, value: 'b.iso' }
    ])
    expect(describeChange([d('ide3', 'ISO:iso/x.iso,media=cdrom,size=366K', '')], fmt)).toEqual([
      { kind: 'removed', label: { text: 'ide3' }, value: 'x.iso' }
    ])
    expect(describeChange([d('ide2', 'local:iso/a.iso,media=cdrom', 'local:iso/a.iso,media=cdrom,size=2M')], fmt)).toEqual([
      { kind: 'modified', label: { text: 'ide2' } }
    ])
  })

  it('reads a NIC by model, bridge, VLAN and IP', () => {
    expect(describeChange([d('net0', 'e1000=AA,bridge=vmbr0', 'virtio=AA,bridge=vmbr1,tag=20')], fmt)).toEqual([
      { kind: 'changed', label: { key: 'model', of: 'net0' }, from: 'e1000', to: 'virtio' },
      { kind: 'changed', label: { key: 'bridge', of: 'net0' }, from: 'vmbr0', to: 'vmbr1' },
      { kind: 'changed', label: { key: 'vlan', of: 'net0' }, from: '-', to: '20' }
    ])
    expect(describeChange([d('net0', 'name=eth0,bridge=vmbr0,ip=dhcp', 'name=eth0,bridge=vmbr0,ip=10.0.0.2/24')], fmt)).toEqual([
      { kind: 'changed', label: { key: 'ip', of: 'net0' }, from: 'dhcp', to: '10.0.0.2/24' }
    ])
    expect(describeChange([d('net0', 'virtio=AA,bridge=vmbr0', 'virtio=BB,bridge=vmbr0')], fmt)).toEqual([
      { kind: 'changed', label: { key: 'mac', of: 'net0' }, from: 'AA', to: 'BB' }
    ])
    expect(describeChange([d('net0', 'virtio=AA,bridge=vmbr0,queues=2', 'virtio=AA,bridge=vmbr0,queues=4')], fmt)).toEqual([
      { kind: 'modified', label: { text: 'net0' } }
    ])
    expect(describeChange([d('net1', '', 'virtio=AA,bridge=vmbr0,tag=5'), d('net2', 'virtio=BB,bridge=vmbr0', '')], fmt)).toEqual([
      { kind: 'added', label: { text: 'net1' }, value: 'vmbr0 · VLAN 5' },
      { kind: 'removed', label: { text: 'net2' }, value: 'vmbr0' }
    ])
  })

  it('reads a NIC firewall, link, MTU and rate, the MAC only when nothing else moved', () => {
    expect(describeChange([d('net0', 'name=eth0,bridge=vmbr0,hwaddr=AA,type=veth', 'name=eth0,bridge=vmbr0,firewall=1,hwaddr=AA,type=veth')], fmt)).toEqual([
      { kind: 'toggled', label: { key: 'firewall', of: 'net0' }, on: true }
    ])
    expect(describeChange([d('net1', 'virtio=AA,bridge=vmbr0', 'virtio=BB,bridge=vmbr0,link_down=1,mtu=9000,rate=50')], fmt)).toEqual([
      { kind: 'toggled', label: { key: 'link', of: 'net1' }, on: false },
      { kind: 'changed', label: { key: 'mtu', of: 'net1' }, from: '-', to: '9000' },
      { kind: 'changed', label: { key: 'rate', of: 'net1' }, from: '-', to: '50' }
    ])
  })

  it('reads tags and snapshots as set changes', () => {
    expect(describeChange([d('tags', 'a;b', 'b;c')], fmt)).toEqual([
      { kind: 'added', label: { key: 'tag' }, value: 'c' },
      { kind: 'removed', label: { key: 'tag' }, value: 'a' }
    ])
    expect(describeChange([d('snapshots', '', 'before-upgrade')], fmt)).toEqual([
      { kind: 'added', label: { key: 'snapshot' }, value: 'before-upgrade' }
    ])
  })

  it('reads toggles, and ignores the agent spelling change', () => {
    expect(describeChange([d('onboot', '', '1')], fmt)).toEqual([{ kind: 'toggled', label: { key: 'onboot' }, on: true }])
    expect(describeChange([d('protection', '1', '0')], fmt)).toEqual([{ kind: 'toggled', label: { key: 'protection' }, on: false }])
    expect(describeChange([d('agent', '1', 'enabled=1')], fmt)).toEqual([])
  })

  it('never shows a secret or a long description', () => {
    expect(describeChange([d('cipassword', '***', '****'), d('description', 'a', 'b')], fmt)).toEqual([
      { kind: 'modified', label: { key: 'password' } },
      { kind: 'modified', label: { key: 'description' } }
    ])
  })

  it('reads an ipconfig by its address', () => {
    expect(describeChange([d('ipconfig0', 'ip=10.77.0.3/24,gw=10.77.0.1', 'ip=10.77.0.5/24,gw=10.77.0.1')], fmt)).toEqual([
      { kind: 'changed', label: { text: 'ipconfig0' }, from: '10.77.0.3/24', to: '10.77.0.5/24' }
    ])
  })

  it('shows short unknown values, hides long ones, and reads add and remove', () => {
    expect(describeChange([d('vga', 'std', 'qxl')], fmt)).toEqual([{ kind: 'changed', label: { text: 'vga' }, from: 'std', to: 'qxl' }])
    expect(describeChange([d('hookscript', '', 'local:snippets/x.sh')], fmt)).toEqual([{ kind: 'added', label: { text: 'hookscript' }, value: 'local:snippets/x.sh' }])
    expect(describeChange([d('name', 'old', '')], fmt)).toEqual([{ kind: 'removed', label: { key: 'name' }, value: 'old' }])
    expect(describeChange([d('args', '', 'x'.repeat(40))], fmt)).toEqual([{ kind: 'modified', label: { text: 'args' } }])
  })

  it('skips unchanged values and an empty diff', () => {
    expect(describeChange([d('cores', '2', '2')], fmt)).toEqual([])
    expect(describeChange(undefined, fmt)).toEqual([])
  })

  it('orders name, sizing, disks, network, then boot', () => {
    const facts = describeChange([
      d('boot', 'order=a', 'order=b'),
      d('net0', '', 'virtio=AA,bridge=vmbr0'),
      d('scsi1', '', 'Z:v,size=1G'),
      d('memory', '1024', '2048'),
      d('name', 'a', 'b'),
      d('vga', 'std', 'qxl')
    ], fmt)

    const name = (f: (typeof facts)[number]) => {
      if (!('label' in f)) return f.kind

      return 'key' in f.label ? f.label.key : f.label.text
    }

    expect(facts.map(name)).toEqual([
      'name', 'memory', 'scsi1', 'net0', 'vga', 'boot'
    ])
  })
})

describe('describeGrouped', () => {
  it('lays the facts out by section and lifts the re-creation out of them', () => {
    const { recreated, groups } = describeGrouped([
      d('meta', 'ctime=1', 'ctime=2'),
      d('net0', 'e1000=AA,bridge=vmbr0', 'virtio=AA,bridge=vmbr0'),
      d('memory', '1024', '2048'),
      d('name', 'a', 'b'),
      d('scsi1', '', 'Z:v,size=1G'),
      d('ipconfig0', 'ip=dhcp', 'ip=10.0.0.2/24'),
      d('sshkeys', 'a', 'b'),
      d('snapshots', '', 'before'),
      d('vga', 'std', 'qxl'),
      d('vmgenid', 'a', 'b')
    ], fmt)

    expect(recreated).toBe(true)
    expect(groups.map(g => [g.group, g.facts.length])).toEqual([
      ['general', 1], ['compute', 1], ['disks', 1], ['network', 2], ['cloudinit', 1], ['snapshots', 1], ['other', 1]
    ])
  })

  it('is empty for an identity stamp alone', () => {
    expect(describeGrouped([d('vmgenid', 'a', 'b')], fmt)).toEqual({ recreated: false, groups: [] })
  })
})

describe('describeSpec', () => {
  it('sizes a created guest from its new values and a deleted one from its old ones', () => {
    const created = [
      d('cores', '', '2'), d('sockets', '', '2'), d('memory', '', '4096'),
      d('scsi0', '', 'Ceph:vm-1-disk-0,size=32G'), d('ide2', '', 'local:iso/x.iso,media=cdrom'),
      d('efidisk0', '', 'Ceph:vm-1-disk-1'), d('unused0', '', 'Ceph:vm-1-disk-9'),
      d('net0', '', 'virtio=AA,bridge=vmbr0'), d('net1', '', 'virtio=BB,bridge=vmbr1')
    ]

    expect(describeSpec(created, 'after', fmt)).toEqual({ vcpus: 4, memory: '4G', disks: 1, nics: 2 })
    expect(describeSpec(created.map(f => ({ ...f, oldValue: f.newValue, newValue: '' })), 'before', fmt)).toEqual({ vcpus: 4, memory: '4G', disks: 1, nics: 2 })
    expect(describeSpec([d('rootfs', '', 'local:subvol-1,size=8G'), d('mp0', '', 'local:subvol-2,size=1G')], 'after', fmt)).toEqual({ vcpus: undefined, memory: undefined, disks: 2, nics: 0 })
  })
})

describe('netFields', () => {
  it('runs each field from its first old value to its last new value', () => {
    expect(netFields([
      { fields: [d('boot', 'order=scsi0', 'order=net0'), d('memory', '1024', '2048')] },
      { fields: [d('boot', 'order=net0', 'order=scsi0'), d('cores', '1', '2')] },
      { fields: [d('memory', '2048', '4096')] }
    ])).toEqual([
      d('memory', '1024', '4096'),
      d('cores', '1', '2')
    ])
  })

  it('is empty when every field came back to where it started', () => {
    expect(netFields([{ fields: [d('boot', 'a', 'b')] }, { fields: [d('boot', 'b', 'a')] }, {}])).toEqual([])
  })
})
