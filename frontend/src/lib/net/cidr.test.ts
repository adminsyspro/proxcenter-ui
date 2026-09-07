import { describe, it, expect } from 'vitest'
import { isPartialIPv4Cidr, isValidCidr } from './cidr'

// The input mask of the replication network field: every keystroke must leave
// a value that can still become an IPv4 CIDR, so "10.10.10.10.10/5566456"
// cannot be typed in the first place.
describe('isPartialIPv4Cidr', () => {
  it('accepts every prefix of a valid CIDR while it is being typed', () => {
    const target = '10.10.50.0/24'
    for (let i = 0; i <= target.length; i++) {
      expect(isPartialIPv4Cidr(target.slice(0, i)), target.slice(0, i)).toBe(true)
    }
    expect(isPartialIPv4Cidr('192.168.1.')).toBe(true)
    expect(isPartialIPv4Cidr('192.168.1.1/')).toBe(true)
    expect(isPartialIPv4Cidr('0.0.0.0/0')).toBe(true)
    expect(isPartialIPv4Cidr('255.255.255.255/32')).toBe(true)
  })

  it('refuses a fifth octet, a double dot and a dot after the slash', () => {
    for (const value of ['10.10.10.10.', '10.10.10.10.10', '10..10', '10.10.50.0/2.', '.10']) {
      expect(isPartialIPv4Cidr(value), value).toBe(false)
    }
  })

  it('refuses an octet above 255 or zero padded, as it is typed', () => {
    for (const value of ['256', '10.300', '10.10.50.999', '010', '10.01']) {
      expect(isPartialIPv4Cidr(value), value).toBe(false)
    }
  })

  it('refuses a slash before the four octets are there, and a prefix above 32', () => {
    for (const value of ['10/', '10.10/24', '10.10.50./24', '10.10.50.0/33', '10.10.50.0/240', '10.10.50.0//24', '/24']) {
      expect(isPartialIPv4Cidr(value), value).toBe(false)
    }
  })

  it('refuses anything but digits, dots and the slash', () => {
    for (const value of ['defsdsf', '10.10.50.0/24 ', 'fd00::/64', '10,10']) {
      expect(isPartialIPv4Cidr(value), value).toBe(false)
    }
  })
})

describe('isValidCidr', () => {
  it('accepts IPv4 networks with a prefix from /0 to /32', () => {
    for (const cidr of ['10.10.50.0/24', '0.0.0.0/0', '192.168.1.1/32', '172.16.0.0/12', '255.255.255.255/31']) {
      expect(isValidCidr(cidr), cidr).toBe(true)
    }
  })

  it('accepts IPv6 networks with a prefix from /0 to /128', () => {
    for (const cidr of [
      '2001:db8::/32', '::/0', '::1/128', 'fd00:10:50::/64', '2001:DB8:0:0:0:0:0:1/128',
      '1:2:3:4:5:6:7:8/64', '1:2:3:4:5:6:7::/112', '::ffff:10.0.0.1/96', '1:2:3:4:5:6:10.0.0.1/128',
      '64:ff9b::192.0.2.33/96',
    ]) {
      expect(isValidCidr(cidr), cidr).toBe(true)
    }
  })

  it('rejects an embedded IPv4 that is not in the last 32 bits', () => {
    // An IPv4 tail must end the address; "::" after it puts zero groups behind it.
    for (const value of ['10.0.0.1::/64', '1:2:192.168.1.1::/64', '::10.0.0.1:1/96']) {
      expect(isValidCidr(value), value).toBe(false)
    }
  })

  it('rejects a bare address, a hostname and an empty value', () => {
    for (const value of ['10.10.50.0', '2001:db8::1', 'pve.lan/24', '', '/24', '10.10.50.0/']) {
      expect(isValidCidr(value), value).toBe(false)
    }
  })

  it('rejects an out-of-range, signed or zero-padded prefix', () => {
    for (const value of ['10.10.50.0/33', '10.10.50.0/-1', '10.10.50.0/+24', '10.10.50.0/024', '2001:db8::/129', '10.0.0.0/24/8', '10.0.0.0/2a']) {
      expect(isValidCidr(value), value).toBe(false)
    }
  })

  it('rejects malformed IPv4 addresses', () => {
    for (const value of ['256.0.0.0/8', '10.0.0/8', '10.0.0.0.1/8', '10.0.0.01/8', '10..0.0/8']) {
      expect(isValidCidr(value), value).toBe(false)
    }
  })

  it('rejects malformed IPv6 addresses', () => {
    for (const value of [
      '1::2::3/64', ':1::/64', '1:::2/64', '1:2:3:4:5:6:7/64', '1:2:3:4:5:6:7:8:9/64', '1:2:3:4:5:6:7:8::/64',
      '12345::/64', '2001:db8::g/64', 'fe80::1%eth0/64', '10.0.0.1::1/64', '::ffff:1.2.3/96', '[2001:db8::]/32',
    ]) {
      expect(isValidCidr(value), value).toBe(false)
    }
  })

  it('does not trim: surrounding whitespace is the caller\'s job', () => {
    expect(isValidCidr(' 10.10.50.0/24')).toBe(false)
    expect(isValidCidr('10.10.50.0/24 ')).toBe(false)
  })

  it('returns false for a non-string input', () => {
    expect(isValidCidr(undefined as unknown as string)).toBe(false)
    expect(isValidCidr(null as unknown as string)).toBe(false)
  })
})
