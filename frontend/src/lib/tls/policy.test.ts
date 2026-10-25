import { describe, expect, it } from 'vitest'

import { buildHttpPolicy, hstsHeaderValue, redirectHost } from '@/lib/tls/policy'
import { DEFAULT_TLS_SETTINGS } from '@/lib/tls/schema'

describe('hstsHeaderValue', () => {
  it('is null when HSTS is off', () => {
    expect(hstsHeaderValue(DEFAULT_TLS_SETTINGS.hsts)).toBeNull()
  })

  it('renders max-age alone by default', () => {
    expect(hstsHeaderValue({ enabled: true, maxAge: 31536000, includeSubDomains: false, preload: false }))
      .toBe('max-age=31536000')
  })

  it('appends the directives that are turned on', () => {
    expect(hstsHeaderValue({ enabled: true, maxAge: 63072000, includeSubDomains: true, preload: true }))
      .toBe('max-age=63072000; includeSubDomains; preload')
  })
})

describe('buildHttpPolicy', () => {
  it('never redirects while TLS is off, whatever redirectHttp says', () => {
    const settings = { ...DEFAULT_TLS_SETTINGS, enabled: false, redirectHttp: true }

    expect(buildHttpPolicy(settings, 'https://pc.example.com').redirect).toBe(false)
  })

  it('redirects when TLS is on and the operator asked for it', () => {
    const settings = { ...DEFAULT_TLS_SETTINGS, enabled: true, redirectHttp: true }

    expect(buildHttpPolicy(settings, 'https://pc.example.com').redirect).toBe(true)
  })

  it('takes the public HTTPS port from APP_URL, since the container port is not what users type', () => {
    const settings = { ...DEFAULT_TLS_SETTINGS, enabled: true }

    expect(buildHttpPolicy(settings, 'https://pc.example.com:8443').httpsPublicPort).toBe(8443)
    expect(buildHttpPolicy(settings, 'https://pc.example.com').httpsPublicPort).toBe(443)
  })

  it('falls back to 443 on a malformed APP_URL rather than throwing', () => {
    const settings = { ...DEFAULT_TLS_SETTINGS, enabled: true }

    expect(buildHttpPolicy(settings, 'not a url').httpsPublicPort).toBe(443)
  })

  it('emits no HSTS header while TLS is off', () => {
    const settings = { ...DEFAULT_TLS_SETTINGS, enabled: false, hsts: { enabled: true, maxAge: 31536000, includeSubDomains: false, preload: false } }

    expect(buildHttpPolicy(settings, 'https://pc.example.com').hstsHeader).toBeNull()
  })
})

describe('redirectHost', () => {
  it('strips the port from a plain hostname', () => {
    expect(redirectHost('pc.example.com:3000')).toBe('pc.example.com')
  })

  it('passes through a hostname with no port', () => {
    expect(redirectHost('pc.example.com')).toBe('pc.example.com')
  })

  it('keeps the brackets around an IPv6 literal with a port', () => {
    expect(redirectHost('[2001:db8::1]:3000')).toBe('[2001:db8::1]')
  })

  it('keeps the brackets around an IPv6 literal with no port', () => {
    expect(redirectHost('[2001:db8::1]')).toBe('[2001:db8::1]')
  })

  it('returns null rather than a broken host for an empty header', () => {
    expect(redirectHost('')).toBeNull()
    expect(redirectHost(undefined)).toBeNull()
  })

  it('returns null for an unterminated IPv6 literal instead of throwing', () => {
    expect(redirectHost('[2001:db8::1')).toBeNull()
  })
})
