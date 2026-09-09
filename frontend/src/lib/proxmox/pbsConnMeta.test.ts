import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/db/prisma', () => ({
  prisma: { connection: { findUnique: vi.fn() } },
}))
vi.mock('@/lib/crypto/secret', () => ({
  decryptSecret: vi.fn(() => 'root@pam!admin:s3cret'),
}))

import { prisma } from '@/lib/db/prisma'

import { PBS_DEFAULT_PORT, parsePbsUser, pbsHostPort, resolvePbsMeta } from './pbsConnMeta'

const findUnique = (prisma as any).connection.findUnique

const row = {
  baseUrl: 'https://pbs.lab:8007',
  fingerprint: 'AA:BB',
  apiTokenEnc: 'enc',
  insecureTLS: true,
  type: 'pbs',
}

beforeEach(() => {
  vi.clearAllMocks()
  findUnique.mockResolvedValue(row)
})

describe('parsePbsUser', () => {
  it('keeps the user@realm part of a token', () => {
    expect(parsePbsUser('backup@pbs!proxcenter:secret')).toBe('backup@pbs')
  })

  it('rejects a credential that is not a token', () => {
    // A PBS connection registered with a plain password cannot own a
    // sub-token, and the failure must name the expected shape.
    expect(() => parsePbsUser('root@pam:password')).toThrow(/user@realm!tokenid/)
  })
})

describe('pbsHostPort', () => {
  it.each([
    ['https://pbs.lab:8007/', 'pbs.lab', 8007],
    ['https://pbs.lab:9007', 'pbs.lab', 9007],
    ['https://pbs.lab', 'pbs.lab', PBS_DEFAULT_PORT],
    ['http://10.42.0.201:8007/some/path', '10.42.0.201', 8007],
    ['https://[::1]:8007', '[::1]', 8007],
    ['https://pbs.lab:not-a-port', 'pbs.lab:not-a-port', PBS_DEFAULT_PORT],
  ])('splits %s into %s:%i', (url, host, port) => {
    expect(pbsHostPort(url)).toEqual({ host, port })
  })

  it('stays linear on a long run of colons', () => {
    // The matched form of this split backtracked polynomially (CodeQL
    // js/polynomial-redos).
    const started = Date.now()

    expect(pbsHostPort(`https://${':'.repeat(100_000)}`).port).toBe(PBS_DEFAULT_PORT)
    expect(Date.now() - started).toBeLessThan(500)
  })
})

describe('resolvePbsMeta', () => {
  it('returns the client, host, port, fingerprint and token owner', async () => {
    const meta = await resolvePbsMeta('pbs1')

    expect(findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'pbs1' } }))
    expect(meta).toEqual({
      conn: { baseUrl: 'https://pbs.lab:8007', apiToken: 'root@pam!admin:s3cret', insecureDev: true },
      host: 'pbs.lab',
      port: 8007,
      fingerprint: 'AA:BB',
      rootUser: 'root@pam',
    })
  })

  it.each([null, { ...row, type: 'pve' }])('rejects a row that is not a PBS connection (%j)', async found => {
    findUnique.mockResolvedValue(found)

    await expect(resolvePbsMeta('pbs1')).rejects.toThrow(/PBS connection not found: pbs1/)
  })

  it('rejects a PBS whose certificate fingerprint was never captured', async () => {
    // PVE pins the certificate, so a missing fingerprint would surface as an
    // opaque probe failure instead of a missing field.
    findUnique.mockResolvedValue({ ...row, fingerprint: null })

    await expect(resolvePbsMeta('pbs1')).rejects.toThrow(/fingerprint missing/)
  })
})
