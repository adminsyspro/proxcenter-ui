import { describe, it, expect } from 'vitest'

import { networkOptions, toSubnetCidr } from './GeneralSection'

describe('toSubnetCidr', () => {
  it('turns a host address into its subnet', () => {
    expect(toSubnetCidr('10.10.10.9/24')).toBe('10.10.10.0/24')
    expect(toSubnetCidr('172.16.10.200/20')).toBe('172.16.0.0/20')
    expect(toSubnetCidr('192.168.1.7/32')).toBe('192.168.1.7/32')
    expect(toSubnetCidr('10.1.2.3/0')).toBe('0.0.0.0/0')
  })

  it('leaves anything it cannot parse untouched', () => {
    for (const v of ['fd00::5/64', 'eno1', '10.10.10.9', '300.1.1.1/24', '10.0.0.1/40']) {
      expect(toSubnetCidr(v)).toBe(v)
    }
  })
})

describe('networkOptions', () => {
  const ifaces = [
    { iface: 'vmbr0', type: 'bridge', active: 1, cidr: '10.10.10.9/24', comments: 'mgmt' },
    { iface: 'bond0', type: 'bond', active: 1, cidr: '10.10.10.10/24' },
    { iface: 'eno1', type: 'eth', active: 1 },
  ]

  it('offers one subnet per network, and bare interfaces by name', () => {
    expect(networkOptions(ifaces, '')).toEqual([
      { value: '10.10.10.0/24', label: 'vmbr0 (10.10.10.0/24) - mgmt' },
      { value: 'eno1', label: 'eno1' },
    ])
  })

  it('keeps the configured value selectable when no interface carries it', () => {
    expect(networkOptions(ifaces, '10.40.0.0/16').at(-1)).toEqual({ value: '10.40.0.0/16', label: '10.40.0.0/16' })
    expect(networkOptions(ifaces, '10.10.10.0/24')).toHaveLength(2)
  })
})
