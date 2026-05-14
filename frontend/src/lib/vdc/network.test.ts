import { describe, it, expect } from 'vitest'

import {
  isValidIpv4,
  ipToInt,
  intToIp,
  parseCidr,
  usableHostCount,
  ipInCidrUsable,
  gatewayValidForCidr,
} from './network'

describe('isValidIpv4', () => {
  it.each([
    ['0.0.0.0', true],
    ['255.255.255.255', true],
    ['10.42.0.1', true],
    ['256.0.0.0', false],
    ['1.2.3', false],
    ['1.2.3.4.5', false],
    ['abc', false],
    ['', false],
    ['10.42.0.001', false],   // leading zeros disallowed (RFC, avoids octal interp)
  ])('isValidIpv4(%s) → %s', (ip, ok) => {
    expect(isValidIpv4(ip)).toBe(ok)
  })
})

describe('ipToInt / intToIp', () => {
  it('round-trips edge values', () => {
    for (const ip of ['0.0.0.0', '127.0.0.1', '192.168.1.1', '255.255.255.255']) {
      const n = ipToInt(ip)!

      expect(intToIp(n)).toBe(ip)
    }
  })
  it('returns null on garbage', () => {
    expect(ipToInt('not.an.ip')).toBeNull()
    expect(ipToInt('999.0.0.0')).toBeNull()
  })
  it('preserves the high bit (no sign issues at 128.x.x.x)', () => {
    const n = ipToInt('128.0.0.0')!

    expect(n).toBeGreaterThan(0)
    expect(intToIp(n)).toBe('128.0.0.0')
  })
})

describe('parseCidr', () => {
  it('parses a /24 with correct network + broadcast', () => {
    const p = parseCidr('10.42.0.0/24')!

    expect(p.prefix).toBe(24)
    expect(intToIp(p.networkInt)).toBe('10.42.0.0')
    expect(intToIp(p.broadcastInt)).toBe('10.42.0.255')
    expect(intToIp(p.firstUsableInt)).toBe('10.42.0.1')
    expect(intToIp(p.lastUsableInt)).toBe('10.42.0.254')
  })
  it('parses a /30: 4 IPs, 2 usable', () => {
    const p = parseCidr('10.0.0.0/30')!

    expect(intToIp(p.firstUsableInt)).toBe('10.0.0.1')
    expect(intToIp(p.lastUsableInt)).toBe('10.0.0.2')
  })
  it('parses /31 RFC3021: both IPs usable', () => {
    const p = parseCidr('10.0.0.0/31')!

    expect(intToIp(p.firstUsableInt)).toBe('10.0.0.0')
    expect(intToIp(p.lastUsableInt)).toBe('10.0.0.1')
  })
  it('parses /32: single host', () => {
    const p = parseCidr('10.0.0.42/32')!

    expect(p.firstUsableInt).toBe(p.lastUsableInt)
    expect(intToIp(p.firstUsableInt)).toBe('10.0.0.42')
  })
  it('aligns IP to network on /N', () => {
    const p = parseCidr('10.42.0.99/24')!

    expect(intToIp(p.networkInt)).toBe('10.42.0.0')
  })
  it('rejects garbage', () => {
    expect(parseCidr('foo')).toBeNull()
    expect(parseCidr('10.0.0.0/33')).toBeNull()
    expect(parseCidr('10.0.0.0/-1')).toBeNull()
    expect(parseCidr('256.0.0.0/8')).toBeNull()
  })
})

describe('usableHostCount', () => {
  it.each([
    ['10.0.0.0/24', 254],
    ['10.0.0.0/30', 2],
    ['10.0.0.0/31', 2],
    ['10.0.0.0/32', 1],
    ['10.0.0.0/16', 65534],
  ])('usableHostCount(%s) = %i', (cidr, expected) => {
    expect(usableHostCount(cidr)).toBe(expected)
  })
})

describe('ipInCidrUsable', () => {
  it('accepts a usable host', () => {
    expect(ipInCidrUsable('10.42.0.1', '10.42.0.0/24')).toBe(true)
    expect(ipInCidrUsable('10.42.0.254', '10.42.0.0/24')).toBe(true)
  })
  it('rejects network + broadcast on /24', () => {
    expect(ipInCidrUsable('10.42.0.0', '10.42.0.0/24')).toBe(false)
    expect(ipInCidrUsable('10.42.0.255', '10.42.0.0/24')).toBe(false)
  })
  it('rejects an IP outside the CIDR', () => {
    expect(ipInCidrUsable('10.42.1.1', '10.42.0.0/24')).toBe(false)
  })
  it('accepts both IPs on /31', () => {
    expect(ipInCidrUsable('10.0.0.0', '10.0.0.0/31')).toBe(true)
    expect(ipInCidrUsable('10.0.0.1', '10.0.0.0/31')).toBe(true)
  })
})

describe('gatewayValidForCidr', () => {
  it('typical /24 gateway .1', () => {
    expect(gatewayValidForCidr('10.42.0.1', '10.42.0.0/24')).toBe(true)
  })
  it('rejects gateway = network address on /24', () => {
    expect(gatewayValidForCidr('10.42.0.0', '10.42.0.0/24')).toBe(false)
  })
  it('rejects gateway outside CIDR', () => {
    expect(gatewayValidForCidr('192.168.0.1', '10.42.0.0/24')).toBe(false)
  })
})
