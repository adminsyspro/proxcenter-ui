import { describe, it, expect } from 'vitest'

import { extractHostFromUrl, replaceHostInUrl, extractPortFromUrl } from './urlUtils'

describe('extractHostFromUrl', () => {
  it('extracts hostname from HTTPS URL', () => {
    expect(extractHostFromUrl('https://pve1.example.com:8006')).toBe('pve1.example.com')
  })

  it('extracts IP from URL', () => {
    expect(extractHostFromUrl('https://192.168.1.100:8006')).toBe('192.168.1.100')
  })

  it('extracts hostname without port', () => {
    expect(extractHostFromUrl('https://pve.local')).toBe('pve.local')
  })

  it('extracts from HTTP URL', () => {
    expect(extractHostFromUrl('http://myhost:3000/path')).toBe('myhost')
  })

  it('returns null for invalid URL', () => {
    expect(extractHostFromUrl('not-a-url')).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(extractHostFromUrl('')).toBeNull()
  })

  it('handles URL with path', () => {
    expect(extractHostFromUrl('https://host.example.com:8006/api/v1')).toBe('host.example.com')
  })

  it('handles IPv6 address (hostname includes brackets)', () => {
    expect(extractHostFromUrl('https://[::1]:8006')).toBe('[::1]')
  })
})

describe('replaceHostInUrl', () => {
  it('replaces hostname keeping port and protocol', () => {
    expect(replaceHostInUrl('https://old.host:8006', 'new.host')).toBe('https://new.host:8006')
  })

  it('replaces IP with hostname', () => {
    expect(replaceHostInUrl('https://192.168.1.1:8006', 'pve2.local')).toBe('https://pve2.local:8006')
  })

  it('replaces hostname with IP', () => {
    expect(replaceHostInUrl('https://pve1.local:8006', '10.0.0.1')).toBe('https://10.0.0.1:8006')
  })

  it('preserves path', () => {
    const result = replaceHostInUrl('https://old.host:8006/api/v1', 'new.host')

    expect(result).toBe('https://new.host:8006/api/v1')
  })

  it('preserves protocol', () => {
    expect(replaceHostInUrl('http://old:3000', 'new')).toBe('http://new:3000')
  })

  it('strips trailing slash', () => {
    const result = replaceHostInUrl('https://old.host:8006', 'new.host')

    expect(result).not.toMatch(/\/$/)
  })
})

describe('extractPortFromUrl', () => {
  it('extracts explicit port', () => {
    expect(extractPortFromUrl('https://host:8006')).toBe(8006)
  })

  it('extracts non-standard port', () => {
    expect(extractPortFromUrl('https://host:3000')).toBe(3000)
  })

  it('returns default port (8006) when no port specified', () => {
    expect(extractPortFromUrl('https://host.example.com')).toBe(8006)
  })

  it('respects custom default port', () => {
    expect(extractPortFromUrl('https://host.example.com', 443)).toBe(443)
  })

  it('returns default port for invalid URL', () => {
    expect(extractPortFromUrl('not-a-url')).toBe(8006)
  })

  it('returns custom default for invalid URL', () => {
    expect(extractPortFromUrl('not-a-url', 9999)).toBe(9999)
  })
})
