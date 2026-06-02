import { describe, it, expect } from 'vitest'
import { isPrivateIp, extractHostname } from './ip'

describe('isPrivateIp', () => {
  it('flags IPv4 private / non-routable ranges', () => {
    for (const ip of ['10.0.0.5', '172.16.4.1', '172.31.255.1', '192.168.1.10',
                       '100.64.0.1', '127.0.0.1', '169.254.1.1', '0.0.0.0']) {
      expect(isPrivateIp(ip), ip).toBe(true)
    }
  })
  it('treats public IPv4 as not private', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '203.0.113.10', '172.32.0.1', '172.15.0.1']) {
      expect(isPrivateIp(ip), ip).toBe(false)
    }
  })
  it('flags IPv6 loopback / link-local / ULA', () => {
    for (const ip of ['::1', 'fe80::1', 'fd00::1', 'fc00::1', '[fe80::1]']) {
      expect(isPrivateIp(ip), ip).toBe(true)
    }
  })
  it('treats public IPv6 as not private', () => {
    expect(isPrivateIp('2606:4700:4700::1111')).toBe(false)
  })
  it('maps IPv4-mapped IPv6 to its IPv4', () => {
    expect(isPrivateIp('::ffff:10.0.0.5')).toBe(true)
    expect(isPrivateIp('::ffff:8.8.8.8')).toBe(false)
  })
  it('returns false for hostnames and garbage', () => {
    for (const h of ['pve.example.com', 'pve.lan', '', 'not-an-ip', '999.1.1.1']) {
      expect(isPrivateIp(h), h).toBe(false)
    }
  })
  it('maps hex-form IPv4-mapped IPv6 to its IPv4', () => {
    expect(isPrivateIp('::ffff:7f00:1')).toBe(true)     // 127.0.0.1
    expect(isPrivateIp('::ffff:0a00:0005')).toBe(true)  // 10.0.0.5
    expect(isPrivateIp('::ffff:c0a8:0101')).toBe(true)  // 192.168.1.1
    expect(isPrivateIp('::ffff:0808:0808')).toBe(false) // 8.8.8.8
  })
  it('flags IPv6 unspecified and multicast as non-routable', () => {
    expect(isPrivateIp('::')).toBe(true)
    expect(isPrivateIp('ff02::1')).toBe(true)
  })
  it('normalizes uppercase IPv6', () => {
    expect(isPrivateIp('FE80::1')).toBe(true)
  })
})

describe('extractHostname', () => {
  it('extracts host from URLs, stripping userinfo and port', () => {
    expect(extractHostname('https://10.0.0.1:8006')).toBe('10.0.0.1')
    expect(extractHostname('https://pve.example.com:8006')).toBe('pve.example.com')
    expect(extractHostname('https://user:pass@host.example:8006')).toBe('host.example')
  })
  it('unbrackets IPv6 URL literals', () => {
    expect(extractHostname('https://[fd00::1]:8006')).toBe('fd00::1')
  })
  it('handles bare hosts and host:port', () => {
    expect(extractHostname('10.0.0.5')).toBe('10.0.0.5')
    expect(extractHostname('10.0.0.5:22')).toBe('10.0.0.5')
    expect(extractHostname('[fd00::1]:22')).toBe('fd00::1')
    expect(extractHostname('pve.lan')).toBe('pve.lan')
  })
  it('returns empty string for empty input', () => {
    expect(extractHostname('')).toBe('')
  })
})
