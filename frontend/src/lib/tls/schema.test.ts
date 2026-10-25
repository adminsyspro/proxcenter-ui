import { describe, expect, it } from 'vitest'

import { DEFAULT_TLS_SETTINGS, resolveTlsPort, tlsSettingsSchema } from '@/lib/tls/schema'

describe('tlsSettingsSchema', () => {
  it('still reads a row saved before DNS-01 existed, as HTTP-01', () => {
    const { challenge: _c, dns: _d, ...acme } = DEFAULT_TLS_SETTINGS.acme
    const parsed = tlsSettingsSchema.parse({ ...DEFAULT_TLS_SETTINGS, acme })

    expect(parsed.acme.challenge).toBe('http-01')
    expect(parsed.acme.dns).toEqual({ provider: null, credentials: {}, validationDelaySeconds: 30 })
  })

  it('rejects an unknown DNS provider and a validation delay past ten minutes', () => {
    const dns = (patch: object) => ({ ...DEFAULT_TLS_SETTINGS, acme: { ...DEFAULT_TLS_SETTINGS.acme, dns: { ...DEFAULT_TLS_SETTINGS.acme.dns, ...patch } } })

    expect(tlsSettingsSchema.safeParse(dns({ provider: 'nope' })).success).toBe(false)
    expect(tlsSettingsSchema.safeParse(dns({ validationDelaySeconds: 601 })).success).toBe(false)
    expect(tlsSettingsSchema.safeParse(dns({ provider: 'rfc2136', validationDelaySeconds: 0 })).success).toBe(true)
  })

  it('accepts the defaults', () => {
    expect(tlsSettingsSchema.parse(DEFAULT_TLS_SETTINGS)).toEqual(DEFAULT_TLS_SETTINGS)
  })

  it('rejects a non-https ACME directory', () => {
    const bad = { ...DEFAULT_TLS_SETTINGS, acme: { ...DEFAULT_TLS_SETTINGS.acme, directoryUrl: 'http://ca.local/dir' } }

    expect(() => tlsSettingsSchema.parse(bad)).toThrow()
  })

  it('rejects a domain that is not a hostname', () => {
    const bad = { ...DEFAULT_TLS_SETTINGS, acme: { ...DEFAULT_TLS_SETTINGS.acme, domains: ['http://pc.example.com'] } }

    expect(() => tlsSettingsSchema.parse(bad)).toThrow()
  })

  it('rejects an HSTS max-age below one hour', () => {
    const bad = { ...DEFAULT_TLS_SETTINGS, hsts: { ...DEFAULT_TLS_SETTINGS.hsts, enabled: true, maxAge: 60 } }

    expect(() => tlsSettingsSchema.parse(bad)).toThrow()
  })

  it('rejects an unknown order status', () => {
    const bad = { ...DEFAULT_TLS_SETTINGS, order: { ...DEFAULT_TLS_SETTINGS.order, status: 'running' } }

    expect(() => tlsSettingsSchema.parse(bad)).toThrow()
  })

  it('keeps renewBeforeDays inside 1..85', () => {
    const bad = { ...DEFAULT_TLS_SETTINGS, acme: { ...DEFAULT_TLS_SETTINGS.acme, renewBeforeDays: 90 } }

    expect(() => tlsSettingsSchema.parse(bad)).toThrow()
  })
})

describe('resolveTlsPort', () => {
  it('falls back to 8443 when TLS_PORT is absent or junk', () => {
    delete process.env.TLS_PORT
    expect(resolveTlsPort()).toBe(8443)
    process.env.TLS_PORT = 'not-a-port'
    expect(resolveTlsPort()).toBe(8443)
    process.env.TLS_PORT = '9443'
    expect(resolveTlsPort()).toBe(9443)
    delete process.env.TLS_PORT
  })
})
