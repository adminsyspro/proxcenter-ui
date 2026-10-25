import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import {
  PemError,
  assertChainOrder,
  assertKeyMatchesCertificate,
  assertNotExpired,
  normalizeCertificatePem,
  parseCertificate,
  splitPemChain,
} from '@/lib/tls/pem'

let dir = ''
let certPem = ''
let keyPem = ''
let otherKeyPem = ''
let otherCertPem = ''

function openssl(args: string[]) {
  execFileSync('openssl', args, { stdio: 'pipe' })
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'pc-pem-'))
  openssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2',
    '-subj', '/CN=pc.example.com',
    '-addext', 'subjectAltName=DNS:pc.example.com,DNS:pc2.example.com,IP:10.42.0.9',
    '-keyout', join(dir, 'k.pem'), '-out', join(dir, 'c.pem')])
  openssl(['genrsa', '-out', join(dir, 'other.pem'), '2048'])
  openssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2',
    '-subj', '/CN=other.example.com',
    '-keyout', join(dir, 'other-k.pem'), '-out', join(dir, 'other-c.pem')])
  certPem = readFileSync(join(dir, 'c.pem'), 'utf8')
  keyPem = readFileSync(join(dir, 'k.pem'), 'utf8')
  otherKeyPem = readFileSync(join(dir, 'other.pem'), 'utf8')
  otherCertPem = readFileSync(join(dir, 'other-c.pem'), 'utf8')
})

afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('parseCertificate', () => {
  it('reads the common name, the SAN list and the fingerprint', () => {
    const parsed = parseCertificate(certPem)

    expect(parsed.commonName).toBe('pc.example.com')
    expect(parsed.sanNames).toEqual(['pc.example.com', 'pc2.example.com', '10.42.0.9'])
    expect(parsed.fingerprint).toMatch(/^[0-9A-F]{2}(:[0-9A-F]{2}){31}$/)
    expect(parsed.notAfter.getTime()).toBeGreaterThan(Date.now())
  })

  it('refuses something that is not a certificate', () => {
    expect(() => parseCertificate('-----BEGIN CERTIFICATE-----\nnope\n-----END CERTIFICATE-----'))
      .toThrow(expect.objectContaining({ code: 'not_a_certificate' }))
  })
})

describe('assertKeyMatchesCertificate', () => {
  it('accepts the matching key', () => {
    expect(() => assertKeyMatchesCertificate(certPem, keyPem)).not.toThrow()
  })

  it('rejects a key from another pair', () => {
    expect(() => assertKeyMatchesCertificate(certPem, otherKeyPem))
      .toThrow(expect.objectContaining({ code: 'key_mismatch' }))
  })

  it('rejects a passphrase-protected key with its own code', () => {
    const enc = join(dir, 'enc.pem')

    openssl(['rsa', '-in', join(dir, 'k.pem'), '-aes256', '-passout', 'pass:secret', '-out', enc])

    expect(() => assertKeyMatchesCertificate(certPem, readFileSync(enc, 'utf8')))
      .toThrow(expect.objectContaining({ code: 'passphrase_protected' }))
  })

  it('rejects a malformed key with unreadable_key, not passphrase_protected', () => {
    // Truncate a valid PEM's body between its real markers. On this stack
    // this, a certificate-as-key, a bit-flipped byte and an empty string all
    // fail with the exact same generic "DECODER routines::unsupported"
    // message as an encrypted key's outer frame, which is the pitfall the
    // passphrase regex must not fall into.
    const lines = keyPem.trim().split('\n')
    const malformed = [lines[0], ...lines.slice(1, Math.ceil(lines.length / 2)), lines[lines.length - 1]].join('\n')

    expect(() => assertKeyMatchesCertificate(certPem, malformed))
      .toThrow(expect.objectContaining({ code: 'unreadable_key' }))
  })
})

describe('assertNotExpired', () => {
  let expiredDir = ''
  let expiredCertPem = ''

  beforeAll(() => {
    // `openssl req -x509` on this build has no -not_before/-not_after, so a
    // validity window entirely in the past is produced with `openssl ca`
    // instead, via a throwaway CA and its -startdate/-enddate options.
    expiredDir = mkdtempSync(join(tmpdir(), 'pc-expired-'))
    const cnf = join(expiredDir, 'ca.cnf')

    writeFileSync(cnf, [
      '[ ca ]',
      'default_ca = CA_default',
      '',
      '[ CA_default ]',
      `database = ${join(expiredDir, 'index.txt')}`,
      `new_certs_dir = ${expiredDir}`,
      `serial = ${join(expiredDir, 'serial.txt')}`,
      'default_md = sha256',
      'policy = policy_anything',
      'email_in_dn = no',
      'unique_subject = no',
      '',
      '[ policy_anything ]',
      'commonName = supplied',
    ].join('\n'))
    writeFileSync(join(expiredDir, 'index.txt'), '')
    writeFileSync(join(expiredDir, 'serial.txt'), '1000\n')

    openssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '3650',
      '-subj', '/CN=Test Expiry CA',
      '-keyout', join(expiredDir, 'ca-key.pem'), '-out', join(expiredDir, 'ca-cert.pem')])
    openssl(['req', '-newkey', 'rsa:2048', '-nodes',
      '-subj', '/CN=expired.example.com',
      '-keyout', join(expiredDir, 'leaf-key.pem'), '-out', join(expiredDir, 'leaf.csr')])
    openssl(['ca', '-config', cnf,
      '-keyfile', join(expiredDir, 'ca-key.pem'), '-cert', join(expiredDir, 'ca-cert.pem'),
      '-startdate', '20200101000000Z', '-enddate', '20200102000000Z',
      '-in', join(expiredDir, 'leaf.csr'), '-out', join(expiredDir, 'leaf-cert.pem'),
      '-batch', '-notext'])

    expiredCertPem = readFileSync(join(expiredDir, 'leaf-cert.pem'), 'utf8')
  })

  afterAll(() => rmSync(expiredDir, { recursive: true, force: true }))

  it('accepts a certificate that has not expired yet', () => {
    expect(() => assertNotExpired(certPem)).not.toThrow()
  })

  it('rejects a certificate whose notAfter is in the past', () => {
    expect(() => assertNotExpired(expiredCertPem))
      .toThrow(expect.objectContaining({ code: 'expired' }))
  })
})

describe('splitPemChain and assertChainOrder', () => {
  let chainDir = ''
  let leafPem = ''
  let issuerPem = ''

  beforeAll(() => {
    chainDir = mkdtempSync(join(tmpdir(), 'pc-chain-'))

    openssl(['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '3650',
      '-subj', '/CN=Test Root CA',
      '-keyout', join(chainDir, 'ca-key.pem'), '-out', join(chainDir, 'ca-cert.pem')])
    openssl(['req', '-newkey', 'rsa:2048', '-nodes',
      '-subj', '/CN=leaf.example.com',
      '-keyout', join(chainDir, 'leaf-key.pem'), '-out', join(chainDir, 'leaf.csr')])
    openssl(['x509', '-req', '-in', join(chainDir, 'leaf.csr'),
      '-CA', join(chainDir, 'ca-cert.pem'), '-CAkey', join(chainDir, 'ca-key.pem'), '-CAcreateserial',
      '-days', '2', '-out', join(chainDir, 'leaf-cert.pem')])

    leafPem = readFileSync(join(chainDir, 'leaf-cert.pem'), 'utf8')
    issuerPem = readFileSync(join(chainDir, 'ca-cert.pem'), 'utf8')
  })

  afterAll(() => rmSync(chainDir, { recursive: true, force: true }))

  describe('splitPemChain', () => {
    it('returns the blocks of a two-certificate bundle in file order', () => {
      const blocks = splitPemChain(`${leafPem}\n${issuerPem}`)

      expect(blocks).toHaveLength(2)
      expect(blocks[0].trim()).toBe(leafPem.trim())
      expect(blocks[1].trim()).toBe(issuerPem.trim())
    })

    it('returns an empty array for a string with no certificate block', () => {
      expect(splitPemChain('not a certificate at all')).toEqual([])
    })
  })

  describe('assertChainOrder', () => {
    it('accepts a correctly ordered leaf-then-issuer bundle', () => {
      expect(() => assertChainOrder(leafPem, issuerPem)).not.toThrow()
    })

    it('throws broken_chain on a reversed bundle', () => {
      expect(() => assertChainOrder(issuerPem, leafPem))
        .toThrow(expect.objectContaining({ code: 'broken_chain' }))
    })

    it('throws broken_chain on an unrelated bundle', () => {
      // certPem is a self-signed certificate from a wholly different key
      // pair, so it was never used to sign leafPem.
      expect(() => assertChainOrder(leafPem, certPem))
        .toThrow(expect.objectContaining({ code: 'broken_chain' }))
    })

    it('is a no-op for a null chain', () => {
      expect(() => assertChainOrder(leafPem, null)).not.toThrow()
    })

    it('is a no-op for a blank chain', () => {
      expect(() => assertChainOrder(leafPem, '   ')).not.toThrow()
    })
  })
})

describe('normalizeCertificatePem', () => {
  it('refuses a combined certificate-and-key PEM outright', () => {
    // The exact shape an operator gets from many tools, and the one that used
    // to land a private key in clear in the cert_pem column.
    expect(() => normalizeCertificatePem(`${certPem}\n${keyPem}`))
      .toThrow(expect.objectContaining({ code: 'private_key_in_certificate' }))
  })

  it('refuses a key on its own, in whatever flavour', () => {
    const flavours = [
      keyPem,
      '-----BEGIN RSA PRIVATE KEY-----\nZm9v\n-----END RSA PRIVATE KEY-----',
      '-----BEGIN EC PRIVATE KEY-----\nZm9v\n-----END EC PRIVATE KEY-----',
      '-----BEGIN ENCRYPTED PRIVATE KEY-----\nZm9v\n-----END ENCRYPTED PRIVATE KEY-----',
      '-----BEGIN OPENSSH PRIVATE KEY-----\nZm9v\n-----END OPENSSH PRIVATE KEY-----',
    ]

    for (const flavour of flavours) {
      expect(() => normalizeCertificatePem(flavour))
        .toThrow(expect.objectContaining({ code: 'private_key_in_certificate' }))
    }
  })

  it('never puts any of the input in the message it hands the UI', () => {
    try {
      normalizeCertificatePem(`${certPem}\n${keyPem}`)
      throw new Error('should have thrown')
    } catch (err: any) {
      expect(err.message).not.toContain('PRIVATE KEY')
      expect(err.message).not.toContain(keyPem.split('\n')[1])
    }
  })

  it('names the field it is complaining about', () => {
    expect(() => normalizeCertificatePem(keyPem, 'chain')).toThrow(/chain field/)
  })

  it('keeps the certificate blocks and drops everything around them', () => {
    const noisy = `subject=CN = pc.example.com\nissuer=CN = pc.example.com\n${certPem}\ntrailing junk\n`

    expect(normalizeCertificatePem(noisy)).toBe(`${certPem.trim()}\n`)
  })

  it('keeps every certificate of a bundle, and only those', () => {
    const bundle = normalizeCertificatePem(`${certPem}\n# intermediate follows\n${otherCertPem}`)
    const blocks = splitPemChain(bundle)

    expect(blocks).toHaveLength(2)
    expect(blocks[0]).toBe(certPem.trim())
    expect(blocks[1]).toBe(otherCertPem.trim())
    expect(bundle).not.toContain('intermediate follows')
  })

  it('rejects input with no certificate at all', () => {
    expect(() => normalizeCertificatePem('nothing here'))
      .toThrow(expect.objectContaining({ code: 'not_a_certificate' }))
  })

  describe('a certificate wrapper is not a certificate', () => {
    // The bypass a second reviewer found: BEGIN/END CERTIFICATE markers are
    // just text, so a key whose own label is whitespace- or case-altered
    // enough to miss the label pattern used to ride into cert_pem inside a
    // fake certificate block. With no separate chain supplied there was no
    // chain validation downstream to catch it either.
    const keyBody = () => keyPem.replace(/-----(BEGIN|END)[^-]*-----/g, '').trim()

    function wrapped(header: string, footer: string) {
      return [
        certPem.trim(),
        '-----BEGIN CERTIFICATE-----',
        header,
        keyBody(),
        footer,
        '-----END CERTIFICATE-----',
      ].join('\n')
    }

    it('rejects a key smuggled inside a second certificate wrapper (doubled space)', () => {
      expect(() => normalizeCertificatePem(wrapped('-----BEGIN  PRIVATE KEY-----', '-----END  PRIVATE KEY-----')))
        .toThrow(expect.objectContaining({ code: 'not_a_certificate' }))
    })

    it('rejects the same with a tab inside the label', () => {
      expect(() => normalizeCertificatePem(wrapped('-----BEGIN PRIVATE\tKEY-----', '-----END PRIVATE\tKEY-----')))
        .toThrow(expect.objectContaining({ code: 'not_a_certificate' }))
    })

    it('rejects the same with a lowercase label', () => {
      expect(() => normalizeCertificatePem(wrapped('-----begin private key-----', '-----end private key-----')))
        .toThrow(expect.objectContaining({ code: 'not_a_certificate' }))
    })

    it('says which block of the bundle is at fault, without quoting any of it', () => {
      try {
        normalizeCertificatePem(wrapped('-----BEGIN  PRIVATE KEY-----', '-----END  PRIVATE KEY-----'))
        throw new Error('should have thrown')
      } catch (err: any) {
        expect(err.message).toContain('block 2')
        expect(err.message).not.toContain(keyBody().slice(0, 24))
      }
    })

    it('rejects a lone block that is wrapped as a certificate but is not one', () => {
      const junk = '-----BEGIN CERTIFICATE-----\nbm90IGEgY2VydGlmaWNhdGU=\n-----END CERTIFICATE-----'

      expect(() => normalizeCertificatePem(junk)).toThrow(expect.objectContaining({ code: 'not_a_certificate' }))
    })

    it('control: a genuine two-certificate bundle still passes', () => {
      expect(() => normalizeCertificatePem(`${certPem}\n${otherCertPem}`)).not.toThrow()
    })
  })
})

describe('PemError', () => {
  it('is an Error', () => {
    expect(new PemError('key_mismatch', 'x')).toBeInstanceOf(Error)
  })
})
