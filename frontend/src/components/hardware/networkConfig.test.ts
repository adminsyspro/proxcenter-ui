import { describe, expect, it } from 'vitest'
import { mergeNetworkConfig } from './networkConfig'

const locked = { canEditMac: false, canEditVlan: false }
const fields = ['bridge', 'tag', 'firewall', 'link_down', 'mtu', 'rate', 'queues']

describe('network edit preserves protected identity', () => {
  it.each(['e1000-82540em', 'e1000-82544gc', 'e1000-82545em', 'ne2k_isa'])('preserves the MAC for an existing %s NIC while toggling its link', model => {
    expect(mergeNetworkConfig(`${model}=AA:BB:CC:DD:EE:FF,bridge=vmbr0`, `${model},bridge=vmbr0,link_down=1`, 'qemu', fields, locked))
      .toBe(`${model}=AA:BB:CC:DD:EE:FF,bridge=vmbr0,link_down=1`)
  })

  it('disconnects a QEMU NIC while preserving MAC, VLAN, trunks and unknown properties', () => {
    const result = mergeNetworkConfig('virtio=AA:BB:CC:DD:EE:FF,bridge=vmbr0,tag=42,trunks=10;20,firewall=0,custom=keep', 'e1000,bridge=vmbr0,macaddr=11:22:33:44:55:66,tag=99,link_down=1', 'qemu', fields, locked)
    expect(result).toBe('e1000=AA:BB:CC:DD:EE:FF,bridge=vmbr0,tag=42,trunks=10;20,custom=keep,link_down=1')
  })
  it('keeps LXC identity while updating link state without removing unexposed IP configuration', () => {
    expect(mergeNetworkConfig('name=eth0,hwaddr=AA:BB:CC:DD:EE:FF,bridge=vmbr0,tag=42,trunks=10;20,ip=dhcp', 'bridge=vmbr0,link_down=1', 'lxc', fields, locked))
      .toBe('name=eth0,hwaddr=AA:BB:CC:DD:EE:FF,bridge=vmbr0,tag=42,trunks=10;20,ip=dhcp,link_down=1')
  })
  it('applies separately granted MAC changes without allowing VLAN removal', () => {
    expect(mergeNetworkConfig('virtio=AA:BB:CC:DD:EE:FF,bridge=vmbr0,tag=42,trunks=10;20', 'virtio,bridge=vmbr0,macaddr=11:22:33:44:55:66', 'qemu', fields, { canEditMac: true, canEditVlan: false }))
      .toBe('virtio=11:22:33:44:55:66,bridge=vmbr0,tag=42,trunks=10;20')
  })
  it('allows explicitly granted VLAN removal while preserving MAC and unexposed trunks', () => {
    expect(mergeNetworkConfig('virtio=AA:BB:CC:DD:EE:FF,bridge=vmbr0,tag=42,trunks=10;20', 'virtio,bridge=vmbr0', 'qemu', fields, { canEditMac: false, canEditVlan: true }))
      .toBe('virtio=AA:BB:CC:DD:EE:FF,bridge=vmbr0,trunks=10;20')
  })
})
