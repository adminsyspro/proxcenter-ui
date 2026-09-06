import { describe, expect, it } from 'vitest'

import { collectNodeAddresses, resolveManagementIp } from './resolveManagementIp'

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
