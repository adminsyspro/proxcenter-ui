import { beforeEach, describe, expect, it, vi } from 'vitest'

// vi.mock is hoisted above this file's top-level `const` bindings, so the
// mock object itself must come from vi.hoisted (same convention as the
// other Prisma-mocked suites in this repo, e.g. src/lib/vdc/context.test.ts)
// or the factory below reads `prismaMock` while it is still in the TDZ.
const { prismaMock } = vi.hoisted(() => {
  const prismaMock: any = {
    tlsCertificate: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
    },
  }
  prismaMock.$transaction = vi.fn(async (ops: any) => (typeof ops === 'function' ? ops(prismaMock) : Promise.all(ops)))

  return { prismaMock }
})

vi.mock('@/lib/db/prisma', () => ({ prisma: prismaMock }))

import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { decryptSecret } from '@/lib/crypto/secret'
import {
  activateCertificate,
  countCertificates,
  getActiveSummary,
  listCertificates,
  loadActiveMaterial,
  saveCertificate,
} from '@/lib/tls/store'

let certPem = ''
let keyPem = ''
let dir = ''

function openssl(args: string[]) {
  execFileSync('openssl', args, { stdio: 'pipe' })
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.APP_SECRET ||= 'test-app-secret-for-tls-store'
  if (!certPem) {
    dir = mkdtempSync(join(tmpdir(), 'pc-store-'))
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '2',
      '-subj', '/CN=store.lab', '-addext', 'subjectAltName=DNS:store.lab',
      '-keyout', join(dir, 'k.pem'), '-out', join(dir, 'c.pem')], { stdio: 'pipe' })
    certPem = readFileSync(join(dir, 'c.pem'), 'utf8')
    keyPem = readFileSync(join(dir, 'k.pem'), 'utf8')
  }
})

describe('saveCertificate', () => {
  it('stores the parsed metadata and an encrypted key, never the raw one', async () => {
    prismaMock.tlsCertificate.create.mockImplementation(async ({ data }: any) => ({ ...data, id: 'c1', createdAt: new Date() }))

    const saved = await saveCertificate({ source: 'uploaded', certPem, keyPem })

    const written = prismaMock.tlsCertificate.create.mock.calls[0][0].data

    expect(written.keyEncrypted).not.toContain('PRIVATE KEY')
    expect(decryptSecret(written.keyEncrypted)).toBe(keyPem)
    expect(written.commonName).toBe('store.lab')
    expect(written.fingerprint).toMatch(/^[0-9A-F]{2}(:[0-9A-F]{2}){31}$/)
    expect(saved.id).toBe('c1')
  })

  it('refuses a combined certificate-and-key PEM instead of storing the key in clear', async () => {
    // The private key would land verbatim in cert_pem, a column that is not
    // encrypted, while the key column next to it is — protecting nothing.
    await expect(saveCertificate({ source: 'uploaded', certPem: `${certPem}\n${keyPem}`, keyPem }))
      .rejects.toThrow(expect.objectContaining({ code: 'private_key_in_certificate' }))

    expect(prismaMock.tlsCertificate.create).not.toHaveBeenCalled()
  })

  it('refuses a private key pasted into the chain field too', async () => {
    await expect(saveCertificate({ source: 'uploaded', certPem, keyPem, chainPem: keyPem }))
      .rejects.toThrow(expect.objectContaining({ code: 'private_key_in_certificate' }))

    expect(prismaMock.tlsCertificate.create).not.toHaveBeenCalled()
  })

  it('persists the normalised certificate, not the raw paste', async () => {
    prismaMock.tlsCertificate.create.mockImplementation(async ({ data }: any) => ({ ...data, id: 'c3', createdAt: new Date() }))

    const noisy = `subject=CN = store.lab\nissuer=CN = store.lab\n${certPem}\n\n`

    await saveCertificate({ source: 'uploaded', certPem: noisy, keyPem })

    const written = prismaMock.tlsCertificate.create.mock.calls[0][0].data

    expect(written.certPem).toBe(`${certPem.trim()}\n`)
    expect(written.certPem).not.toContain('subject=')
  })

  it('refuses a mismatched key before touching the database', async () => {
    execFileSync('openssl', ['genrsa', '-out', join(dir, 'x.pem'), '2048'], { stdio: 'pipe' })

    await expect(saveCertificate({ source: 'uploaded', certPem, keyPem: readFileSync(join(dir, 'x.pem'), 'utf8') }))
      .rejects.toThrow(expect.objectContaining({ code: 'key_mismatch' }))

    expect(prismaMock.tlsCertificate.create).not.toHaveBeenCalled()
  })

  it('deactivates the previous certificate when asked to activate', async () => {
    prismaMock.tlsCertificate.create.mockImplementation(async ({ data }: any) => ({ ...data, id: 'c2', createdAt: new Date() }))

    await saveCertificate({ source: 'acme', certPem, keyPem, activate: true })

    expect(prismaMock.tlsCertificate.updateMany).toHaveBeenCalledWith({
      where: { isActive: true },
      data: { isActive: false },
    })
    // Both writes must go through the same transaction, deactivate first,
    // so the partial unique index never sees two active rows at once.
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1)
    expect(prismaMock.tlsCertificate.updateMany.mock.invocationCallOrder[0])
      .toBeLessThan(prismaMock.tlsCertificate.create.mock.invocationCallOrder[0])
  })

  it('refuses an already-expired certificate before touching the database', async () => {
    // `openssl req -x509` on this build has no -not_before/-not_after, so a
    // validity window entirely in the past is produced with `openssl ca`
    // instead, via a throwaway CA and its -startdate/-enddate options (same
    // approach as the `assertNotExpired` coverage in pem.test.ts).
    const expiredDir = mkdtempSync(join(tmpdir(), 'pc-store-expired-'))
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
      '-subj', '/CN=expired.store.lab',
      '-keyout', join(expiredDir, 'leaf-key.pem'), '-out', join(expiredDir, 'leaf.csr')])
    openssl(['ca', '-config', cnf,
      '-keyfile', join(expiredDir, 'ca-key.pem'), '-cert', join(expiredDir, 'ca-cert.pem'),
      '-startdate', '20200101000000Z', '-enddate', '20200102000000Z',
      '-in', join(expiredDir, 'leaf.csr'), '-out', join(expiredDir, 'leaf-cert.pem'),
      '-batch', '-notext'])

    const expiredCertPem = readFileSync(join(expiredDir, 'leaf-cert.pem'), 'utf8')
    const expiredKeyPem = readFileSync(join(expiredDir, 'leaf-key.pem'), 'utf8')

    rmSync(expiredDir, { recursive: true, force: true })

    await expect(saveCertificate({ source: 'uploaded', certPem: expiredCertPem, keyPem: expiredKeyPem }))
      .rejects.toThrow(expect.objectContaining({ code: 'expired' }))

    expect(prismaMock.tlsCertificate.create).not.toHaveBeenCalled()
  })
})

describe('loadActiveMaterial', () => {
  it('decrypts the key on the way out', async () => {
    const { encryptSecret } = await import('@/lib/crypto/secret')

    prismaMock.tlsCertificate.findFirst.mockResolvedValue({
      id: 'c1', fingerprint: 'AA:BB', certPem, chainPem: null, keyEncrypted: encryptSecret(keyPem),
    })

    await expect(loadActiveMaterial()).resolves.toMatchObject({ id: 'c1', keyPem })
  })

  it('returns null when nothing is active', async () => {
    prismaMock.tlsCertificate.findFirst.mockResolvedValue(null)

    await expect(loadActiveMaterial()).resolves.toBeNull()
  })
})

describe('activateCertificate', () => {
  it('raises when the id is unknown', async () => {
    prismaMock.tlsCertificate.findUnique.mockResolvedValue(null)

    await expect(activateCertificate('nope')).rejects.toThrow(/unknown certificate/i)
  })

  it('deactivates the previous certificate before activating the target, in one transaction', async () => {
    prismaMock.tlsCertificate.findUnique.mockResolvedValue({ id: 'c2', isActive: false })
    prismaMock.tlsCertificate.update.mockImplementation(async ({ data }: any) => ({
      id: 'c2',
      source: 'uploaded',
      commonName: 'store.lab',
      sanNames: ['store.lab'],
      issuer: 'CN=store.lab',
      serial: '1',
      fingerprint: 'AA:BB',
      notBefore: new Date(),
      notAfter: new Date(),
      createdAt: new Date(),
      ...data,
    }))

    const summary = await activateCertificate('c2')

    expect(prismaMock.tlsCertificate.updateMany).toHaveBeenCalledWith({
      where: { isActive: true },
      data: { isActive: false },
    })
    expect(prismaMock.tlsCertificate.update).toHaveBeenCalledWith({ where: { id: 'c2' }, data: { isActive: true } })
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1)
    expect(prismaMock.tlsCertificate.updateMany.mock.invocationCallOrder[0])
      .toBeLessThan(prismaMock.tlsCertificate.update.mock.invocationCallOrder[0])
    expect(summary.isActive).toBe(true)
    expect(summary.id).toBe('c2')
  })
})

describe('getActiveSummary', () => {
  it('returns a summary with no key field when a certificate is active', async () => {
    prismaMock.tlsCertificate.findFirst.mockResolvedValue({
      id: 'c1',
      source: 'uploaded',
      commonName: 'store.lab',
      sanNames: ['store.lab'],
      issuer: 'CN=store.lab',
      serial: '1',
      fingerprint: 'AA:BB',
      notBefore: new Date('2026-01-01'),
      notAfter: new Date('2027-01-01'),
      isActive: true,
      createdAt: new Date('2026-01-01'),
      // A real row also carries keyEncrypted; the summary must never surface it.
      keyEncrypted: 'super-secret-should-not-surface',
    })

    const summary = await getActiveSummary()

    expect(summary).toMatchObject({ id: 'c1', commonName: 'store.lab', isActive: true })
    expect(summary).not.toHaveProperty('keyEncrypted')
    expect(summary).not.toHaveProperty('keyPem')
    expect(JSON.stringify(summary)).not.toContain('super-secret-should-not-surface')
  })

  it('returns null when no certificate is active', async () => {
    prismaMock.tlsCertificate.findFirst.mockResolvedValue(null)

    await expect(getActiveSummary()).resolves.toBeNull()
  })
})

describe('listCertificates', () => {
  it('orders by createdAt descending and honours the limit', async () => {
    prismaMock.tlsCertificate.findMany.mockResolvedValue([
      {
        id: 'newest', source: 'uploaded', commonName: 'a.lab', sanNames: [], issuer: 'i', serial: '1',
        fingerprint: 'f1', notBefore: new Date(), notAfter: new Date(), isActive: false, createdAt: new Date('2026-02-01'),
      },
    ])

    const rows = await listCertificates(5)

    expect(prismaMock.tlsCertificate.findMany).toHaveBeenCalledWith({ orderBy: { createdAt: 'desc' }, take: 5 })
    expect(rows).toHaveLength(1)
    expect(rows[0].id).toBe('newest')
  })

  it('defaults to a limit of 20', async () => {
    prismaMock.tlsCertificate.findMany.mockResolvedValue([])

    await listCertificates()

    expect(prismaMock.tlsCertificate.findMany).toHaveBeenCalledWith({ orderBy: { createdAt: 'desc' }, take: 20 })
  })
})

describe('countCertificates', () => {
  it('returns the row count', async () => {
    prismaMock.tlsCertificate.count.mockResolvedValue(3)

    await expect(countCertificates()).resolves.toBe(3)
  })
})
