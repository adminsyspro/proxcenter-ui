import { hostname as osHostname } from 'node:os'

import { afterEach, describe, expect, it } from 'vitest'

import { assertKeyMatchesCertificate, parseCertificate } from '@/lib/tls/pem'
import { defaultSelfSignedNames, generateSelfSigned } from '@/lib/tls/selfSigned'

describe('generateSelfSigned', () => {
  it('produces a certificate whose key matches and whose SANs are the ones asked for', async () => {
    const { certPem, keyPem } = await generateSelfSigned({
      commonName: 'proxcenter.lab',
      sanNames: ['proxcenter.lab', '10.42.0.9'],
      days: 10,
    })

    expect(() => assertKeyMatchesCertificate(certPem, keyPem)).not.toThrow()

    const parsed = parseCertificate(certPem)

    expect(parsed.commonName).toBe('proxcenter.lab')
    expect(parsed.sanNames).toEqual(['proxcenter.lab', '10.42.0.9'])
    expect(parsed.issuer).toContain('proxcenter.lab')
  })

  it('honours the requested validity window', async () => {
    const { certPem } = await generateSelfSigned({ commonName: 'a.lab', days: 5 })
    const { notBefore, notAfter } = parseCertificate(certPem)
    const days = (notAfter.getTime() - notBefore.getTime()) / 86_400_000

    expect(days).toBeGreaterThan(4.5)
    expect(days).toBeLessThan(5.5)
  })

  it('always includes the common name in the SAN list, even when none is given', async () => {
    const { certPem } = await generateSelfSigned({ commonName: 'solo.lab' })

    expect(parseCertificate(certPem).sanNames).toContain('solo.lab')
  })

  it('gives each certificate a distinct serial', async () => {
    const a = parseCertificate((await generateSelfSigned({ commonName: 'a.lab' })).certPem)
    const b = parseCertificate((await generateSelfSigned({ commonName: 'a.lab' })).certPem)

    expect(a.serial).not.toBe(b.serial)
  })

  it('marks it as a server certificate that is not a CA', async () => {
    const { X509Certificate } = await import('node:crypto')
    const cert = new X509Certificate((await generateSelfSigned({ commonName: 'a.lab' })).certPem)

    expect(cert.ca).toBe(false)
    expect(cert.keyUsage).toEqual(['1.3.6.1.5.5.7.3.1'])
  })

  it('keeps a name too long for a CN in the SAN alone', async () => {
    const long = `${'a'.repeat(60)}.example.com`
    const parsed = parseCertificate((await generateSelfSigned({ commonName: long })).certPem)

    expect(parsed.sanNames).toEqual([long])
  })
})

describe('defaultSelfSignedNames', () => {
  const originalAppUrl = process.env.APP_URL

  afterEach(() => {
    if (originalAppUrl === undefined) delete process.env.APP_URL
    else process.env.APP_URL = originalAppUrl
  })

  it('takes the common name from APP_URL when it is set', () => {
    process.env.APP_URL = 'https://pc.example.com'

    expect(defaultSelfSignedNames().commonName).toBe('pc.example.com')
  })

  it('falls back to the OS hostname without throwing when APP_URL is unparseable', () => {
    process.env.APP_URL = 'not a url'

    expect(() => defaultSelfSignedNames()).not.toThrow()
    expect(defaultSelfSignedNames().commonName).toBe(osHostname())
  })

  it('falls back to the OS hostname when APP_URL is unset', () => {
    delete process.env.APP_URL

    expect(defaultSelfSignedNames().commonName).toBe(osHostname())
  })

  it('always includes the common name, localhost and 127.0.0.1 in sanNames, with no duplicates', () => {
    delete process.env.APP_URL

    const { commonName, sanNames } = defaultSelfSignedNames()

    expect(sanNames).toContain(commonName)
    expect(sanNames).toContain('localhost')
    expect(sanNames).toContain('127.0.0.1')
    expect(new Set(sanNames).size).toBe(sanNames.length)
  })
})
