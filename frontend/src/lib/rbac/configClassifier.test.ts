/**
 * classifyConfigKey / classifyConfigBody (#897): which vm.config.* permission
 * each guest config key needs, so a PUT on the config is gated per key rather
 * than by one blanket right. Run with the unit config (no Postgres):
 *   npx vitest run --config vitest.unit.config.ts src/lib/rbac/configClassifier.test.ts
 */
import { describe, expect, it, vi } from 'vitest'

// The classifier only reads the constants; the rbac index itself pulls Prisma and Next.
vi.mock('./index', () => ({
  PERMISSIONS: {
    VM_CONFIG: 'vm.config',
    VM_CONFIG_MEDIA: 'vm.config.media',
    VM_CONFIG_NIC_LINK: 'vm.config.nic.link',
    VM_CONFIG_NIC: 'vm.config.nic',
    VM_CONFIG_HARDWARE: 'vm.config.hardware',
    VM_CONFIG_BOOT: 'vm.config.boot',
  },
}))

import { classifyConfigBody, classifyConfigKey } from './configClassifier'

describe('classifyConfigKey', () => {
  it('allows media changes only on an existing optical drive', () => {
    for (const key of ['ide2', 'sata1', 'scsi3']) {
      const current = { [key]: 'none,media=cdrom' }
      expect(classifyConfigKey(key, 'local:iso/debian.iso,media=cdrom', current)).toBe('vm.config.media')
      expect(classifyConfigKey(key, 'iso.library:iso/debian.iso,media=cdrom', current)).toBe('vm.config.media')
      expect(classifyConfigKey(key, 'none,media=cdrom', { [key]: 'local:iso/debian.iso,media=cdrom,size=1G' })).toBe('vm.config.media')
      expect(classifyConfigKey(key, 'local:iso/debian.iso,media=cdrom')).toBe('vm.config.hardware')
    }
    expect(classifyConfigKey('sata1', 'cdrom', { sata1: 'none,media=cdrom' })).toBe('vm.config.hardware')
    expect(classifyConfigKey('scsi0', 'local-lvm:vm-100-disk-0,size=32G')).toBe('vm.config.hardware')
    expect(classifyConfigKey('ide0', undefined)).toBe('vm.config.hardware')
  })

  it('never authorizes data disks, cloud-init, allocations or disk options as media', () => {
    const old = 'local:iso/old.iso,media=cdrom,cache=none,backup=0'
    for (const value of [
      'local:iso/new.iso,media=cdrom,cache=writeback,backup=0',
      'local:iso/new.iso,media=cdrom,cache=none',
      'local:iso/new.iso,media=cdrom,cache=none,backup=0,iothread=1',
      'local:iso/new.iso,media=cdrom,media=disk,cache=none,backup=0',
      'local:iso/new.iso,xmedia=cdrom,cache=none,backup=0',
      'local:vm-200-disk-0,media=cdrom,cache=none,backup=0',
      'local:32,media=cdrom,cache=none,backup=0',
      'local:0,import-from=local:iso/new.iso,media=cdrom,cache=none,backup=0',
      '/dev/sda,media=cdrom,cache=none,backup=0',
      'local:iso/../vm-200-disk-0,media=cdrom,cache=none,backup=0',
      'local:iso/new.iso,media=cdrom,cache=none,backup=0,size=100G',
    ]) expect(classifyConfigKey('sata0', value, { sata0: old })).toBe('vm.config.hardware')
    expect(classifyConfigKey('sata0', 'local:iso/new.iso,media=cdrom,backup=0,cache=none', { sata0: old })).toBe('vm.config.media')
    expect(classifyConfigKey('sata0', 'none,media=cdrom', { sata0: 'local:vm-100-disk-0' })).toBe('vm.config.hardware')
    expect(classifyConfigKey('ide2', 'none,media=cdrom', { ide2: 'local:vm-100-cloudinit,media=cdrom' })).toBe('vm.config.hardware')
  })

  it('files a NIC under nic, or under nic.link when only link_down toggles', () => {
    const current = { net0: 'virtio=BC:24:11:00:00:01,bridge=vmbr0,tag=100' }
    expect(classifyConfigKey('net0', 'virtio=BC:24:11:00:00:01,bridge=vmbr0,tag=100,link_down=1', current)).toBe('vm.config.nic.link')
    expect(classifyConfigKey('net0', 'virtio=BC:24:11:00:00:01,bridge=vmbr0,tag=100', { net0: `${current.net0},link_down=1` })).toBe('vm.config.nic.link')
    // The bridge changes too: a full NIC edit.
    expect(classifyConfigKey('net0', 'virtio=BC:24:11:00:00:01,bridge=vmbr1,tag=100,link_down=1', current)).toBe('vm.config.nic')
    // Same value, nothing toggled: not a link change either.
    expect(classifyConfigKey('net0', current.net0, current)).toBe('vm.config.nic')
    // Without the current config, or for a new NIC, the full right is needed.
    expect(classifyConfigKey('net1', 'virtio,bridge=vmbr0,link_down=1')).toBe('vm.config.nic')
    expect(classifyConfigKey('net1', 'virtio,bridge=vmbr0,link_down=1', current)).toBe('vm.config.nic')
    expect(classifyConfigKey('net0', '', current)).toBe('vm.config.nic')
  })

  it('files boot, CPU, memory, display and indexed devices, and leaves the rest to vm.config', () => {
    for (const k of ['boot', 'bootdisk', 'bios', 'machine']) expect(classifyConfigKey(k, 'x')).toBe('vm.config.boot')
    for (const k of ['cores', 'sockets', 'cpu', 'vcpus', 'cpulimit', 'cpuunits', 'numa', 'memory', 'balloon', 'shares', 'swap', 'scsihw', 'vga', 'rng0']) {
      expect(classifyConfigKey(k, 1)).toBe('vm.config.hardware')
    }
    for (const k of ['virtio3', 'unused0', 'hostpci1', 'usb2', 'efidisk0', 'tpmstate0', 'serial0', 'audio0']) {
      expect(classifyConfigKey(k, 'x')).toBe('vm.config.hardware')
    }
    for (const k of ['name', 'description', 'tags', 'onboot', 'agent', 'ostype']) expect(classifyConfigKey(k, 'x')).toBe('vm.config')
  })
})

describe('classifyConfigBody', () => {
  it('collects one right per key, including the keys named in delete and revert', () => {
    const current = { net0: 'virtio=BC:24:11:00:00:01,bridge=vmbr0', ide2: 'none,media=cdrom', scsi1: 'local:1/x.qcow2', cores: 2 }
    const required = classifyConfigBody(
      { name: 'web', memory: 2048, net0: 'virtio=BC:24:11:00:00:01,bridge=vmbr0,link_down=1', delete: 'ide2, scsi1', revert: 'cores' },
      current,
    )
    expect([...required].sort((a, b) => a.localeCompare(b))).toEqual([
      'vm.config',
      'vm.config.hardware',
      'vm.config.nic.link',
    ])
  })

  it('ignores a delete or revert that is not a string, and yields nothing for an empty body', () => {
    expect(classifyConfigBody({ delete: ['ide2'] as unknown as string })).toEqual(new Set())
    expect(classifyConfigBody({})).toEqual(new Set())
    expect(classifyConfigBody({ boot: 'order=scsi0' })).toEqual(new Set(['vm.config.boot']))
  })
})


it('requires hardware for deleting or reverting a CD-ROM device', () => {
  const current = { sata0: 'none,media=cdrom' }
  expect(classifyConfigBody({ delete: 'sata0' }, current)).toEqual(new Set(['vm.config.hardware']))
  expect(classifyConfigBody({ revert: 'sata0' }, current)).toEqual(new Set(['vm.config.hardware']))
})
