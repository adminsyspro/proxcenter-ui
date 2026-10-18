import { describe, expect, it } from 'vitest'

import { collectNodeAddresses, resolveManagementAddress, resolveManagementIp } from './resolveManagementIp'

describe('collectNodeAddresses', () => {
  it('collects unique searchable IPv4 and IPv6 addresses with prefixes stripped', () => {
    expect(collectNodeAddresses([
      { iface: 'lo', address: '127.0.0.1/8', address6: '::1/128' },
      { iface: 'vmbr0', address: '192.168.1.2/24', address6: '2001:db8::2/64' },
      { iface: 'storage', address: '10.20.0.2', address6: 'fe80::2/64' },
      { iface: 'duplicate', address: '192.168.1.2/24' },
    ])).toEqual(['192.168.1.2', '2001:db8::2', '10.20.0.2'])
  })

  it('returns an empty list for non-array input', () => {
    expect(collectNodeAddresses(null as any)).toEqual([])
  })
})

describe('resolveManagementIp', () => {
  it('prefers an interface with a gateway', () => {
    expect(resolveManagementIp([
      { iface: 'vmbr0', address: '10.0.0.2' },
      { iface: 'mgmt', address: '192.168.1.2', gateway: '192.168.1.1' },
    ])).toBe('192.168.1.2')
  })

  it('falls back to vmbr0', () => {
    expect(resolveManagementIp([
      { iface: 'eth0', address: '10.0.0.2' },
      { iface: 'vmbr0', address: '192.168.1.2' },
      { iface: 'vmbr1', address: '172.16.0.2' },
    ])).toBe('192.168.1.2')
  })

  it('falls back to any vmbr interface', () => {
    expect(resolveManagementIp([
      { iface: 'eth0', address: '10.0.0.2' },
      { iface: 'vmbr2', address: '172.16.0.2' },
    ])).toBe('172.16.0.2')
  })

  it('finally uses the first active non-loopback interface', () => {
    expect(resolveManagementIp([
      { iface: 'lo', address: '127.0.0.1' },
      { iface: 'eth0', address: '10.0.0.2' },
      { iface: 'eth1', address: '10.0.1.2' },
    ])).toBe('10.0.0.2')
  })
})

describe('resolveManagementAddress', () => {
  it('verifies the gateway interface, Linux bridge or OVS port alike', () => {
    expect(resolveManagementAddress([
      { iface: 'vmbr0', type: 'bridge', address: '10.0.0.2' },
      { iface: 'mgmt', type: 'OVSIntPort', address: '192.168.1.2', gateway: '192.168.1.1' },
    ])).toEqual({ ip: '192.168.1.2', verified: true })
  })

  it('verifies vmbr0 without a gateway', () => {
    expect(resolveManagementAddress([
      { iface: 'eth0', type: 'eth', address: '10.0.0.2' },
      { iface: 'vmbr0', type: 'bridge', address: '192.168.1.2' },
    ])).toEqual({ ip: '192.168.1.2', verified: true })
  })

  // roadmap#51: the list a token without SDN.Audit on /sdn/zones/localnetwork
  // gets from pve-manager, every bridge removed. Measured on PVE 9.2: only
  // the VXLAN transport VLAN keeps an address, and it is not a bridge.
  it('only guesses from a list without the management bridge, and a VLAN on vmbr0 is no bridge', () => {
    expect(resolveManagementAddress([
      { iface: 'nic0', type: 'eth', active: 1 },
      { iface: 'vmbr0.4000', type: 'vlan', address: '10.100.5.2', cidr: '10.100.5.2/24', 'vlan-raw-device': 'vmbr0' },
    ])).toEqual({ ip: '10.100.5.2', verified: false })
    expect(resolveManagementAddress([{ iface: 'vmbr0.4000', address: '10.100.5.2' }])).toEqual({ ip: '10.100.5.2', verified: false })
  })

  it('guesses another bridge before a plain interface', () => {
    expect(resolveManagementAddress([
      { iface: 'eth0', address: '10.0.0.2' },
      { iface: 'vmbr2', type: 'bridge', address: '172.16.0.2' },
    ])).toEqual({ ip: '172.16.0.2', verified: false })
  })

  it('answers nothing for an empty or non-array list', () => {
    expect(resolveManagementAddress([])).toBeUndefined()
    expect(resolveManagementAddress(null as any)).toBeUndefined()
  })
})
