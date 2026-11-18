import { describe, expect, it } from 'vitest'

import { isManySources, networkByCidr, networkOf, networksProblem, parseNetwork, MAX_NAMED_NETWORKS, MAX_NETWORK_NAME } from './namedNetworks'

const NETS = [
  { name: 'Wide', cidr: '10.0.0.0/8' },
  { name: 'VPN', cidr: '192.168.72.0/24' },
  { name: 'Lab', cidr: '10.72.0.0/16' },
  { name: 'Odd', cidr: '172.16.5.128/25' },
  { name: 'v6', cidr: '2001:db8:abcd::/48' },
]

describe('parseNetwork', () => {
  it('reads a CIDR of either family, a host address in it too, and refuses anything else', () => {
    expect(parseNetwork('192.168.72.0/24')).toEqual({ base: [0xc0a8, 0x4800], length: 24 })
    expect(parseNetwork(' 192.168.72.9/24 ')).toEqual({ base: [0xc0a8, 0x4800], length: 24 })
    expect(parseNetwork('2001:db8::/32')?.length).toBe(32)
    for (const bad of ['', '192.168.72.1', '192.168.72.0/33', '0.0.0.0/0', '::/0', 'vpn/24', '300.1.1.1/8', '1.2.3/8', '2001:db8:::/32', '2001:db8::/129']) {
      expect(parseNetwork(bad), bad).toBeNull()
    }
  })
})

describe('networkOf', () => {
  it('finds the network of an address, the most specific one', () => {
    expect(networkOf('192.168.72.17', NETS)?.name).toBe('VPN')
    expect(networkOf('10.72.3.4', NETS)?.name).toBe('Lab')
    expect(networkOf('10.9.9.9', NETS)?.name).toBe('Wide')
    expect(networkOf('172.16.5.200', NETS)?.name).toBe('Odd')
    expect(networkOf('172.16.5.100', NETS)).toBeNull()
    expect(networkOf('2001:db8:abcd:12::7', NETS)?.name).toBe('v6')
    expect(networkOf('2001:db8:abce::1', NETS)).toBeNull()
  })

  it('reads an address written with a mask or a zone, and knows none for what is no address', () => {
    expect(networkOf('192.168.72.17/32', NETS)?.name).toBe('VPN')
    expect(networkOf('fe80::1%eth0', [{ name: 'll', cidr: 'fe80::/10' }])?.name).toBe('ll')
    for (const none of [undefined, '', 'web', '192.0.2.1']) expect(networkOf(none, NETS)).toBeNull()
    expect(networkOf('192.168.72.17', [])).toBeNull()
    expect(networkOf('192.168.72.17', undefined)).toBeNull()
  })
})

describe('the source key of an observed flow', () => {
  it('is a named network by its CIDR, or many sources for a whole family', () => {
    expect(networkByCidr('192.168.72.0/24', NETS)?.name).toBe('VPN')
    expect(networkByCidr('192.168.73.0/24', NETS)).toBeNull()
    expect(networkByCidr('192.168.72.17', NETS)).toBeNull()
    expect(networkByCidr(undefined, NETS)).toBeNull()
    expect(isManySources('0.0.0.0/0')).toBe(true)
    expect(isManySources('::/0')).toBe(true)
    expect(isManySources('192.168.72.0/24')).toBe(false)
  })
})

describe('networksProblem', () => {
  it('accepts networks that can be saved', () => {
    expect(networksProblem(NETS)).toBeNull()
    expect(networksProblem([])).toBeNull()
  })

  it('says the first problem: a name, a CIDR, a name or a network used twice, too many', () => {
    expect(networksProblem([{ name: ' ', cidr: '10.0.0.0/8' }])).toEqual({ key: 'networkName', values: { max: MAX_NETWORK_NAME } })
    expect(networksProblem([{ name: 'x'.repeat(MAX_NETWORK_NAME + 1), cidr: '10.0.0.0/8' }])?.key).toBe('networkName')
    expect(networksProblem([{ name: 'VPN', cidr: '192.168.72.1' }])).toEqual({ key: 'networkCidr', values: { name: 'VPN' } })
    expect(networksProblem([{ name: 'All', cidr: '0.0.0.0/0' }])?.key).toBe('networkCidr')
    expect(networksProblem([{ name: 'VPN', cidr: '10.0.0.0/8' }, { name: 'vpn', cidr: '10.1.0.0/16' }])).toEqual({ key: 'networkNameTwice', values: { name: 'vpn' } })
    expect(networksProblem([{ name: 'A', cidr: '10.0.0.0/8' }, { name: 'B', cidr: '10.9.9.9/8' }])).toEqual({ key: 'networkTwice', values: { name: 'B' } })
    const many = Array.from({ length: MAX_NAMED_NETWORKS + 1 }, (_, i) => ({ name: `n${i}`, cidr: `10.${i}.0.0/16` }))
    expect(networksProblem(many)).toEqual({ key: 'networkTooMany', values: { max: MAX_NAMED_NETWORKS } })
  })
})
