import { createPrivateKey } from 'node:crypto'

import { beforeEach, describe, expect, it, vi } from 'vitest'

// vi.mock is hoisted above this file's top-level `const` bindings, so every
// mock a factory closes over comes from vi.hoisted.
const { prismaMock, challenges } = vi.hoisted(() => ({
  prismaMock: { tlsAcmeAccount: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() } },
  challenges: { putChallenge: vi.fn(), dropChallenge: vi.fn() },
}))

vi.mock('@/lib/db/prisma', () => ({ prisma: prismaMock }))
vi.mock('@/lib/tls/challengeStore', () => challenges)

import { encryptSecret } from '@/lib/crypto/secret'
import { orderCertificate, type OrderInput } from '@/lib/tls/acme'
import { dns01Value, generateAccountKeyPem } from '@/lib/tls/acmeClient'
import { CHAIN_PEM, createFakeCa, DIRECTORY_URL, type FakeCaOptions, LEAF_PEM } from '@/lib/tls/__tests__/fakeAcmeCa'

process.env.APP_SECRET ||= 'acme-test-secret'

const sleep = vi.fn(async () => {})

function order(ca: ReturnType<typeof createFakeCa>, patch: Partial<OrderInput> = {}) {
  return orderCertificate({
    directoryUrl: DIRECTORY_URL, email: 'ops@pcx.lab', domains: ['pcx.lab'], eab: null,
    transport: { fetch: ca.fetch, sleep },
    ...patch,
  })
}

/** A CA that only passes a challenge the client really published. */
function strictCa(options: FakeCaOptions = {}, dnsValues?: Map<string, string[]>) {
  return createFakeCa({
    validate: (challenge, authz, keyAuthorization) => {
      if (challenge.type === 'http-01') {
        const served = challenges.putChallenge.mock.calls.some(([token, keyAuth]) => token === challenge.token && keyAuth === keyAuthorization)

        return served ? null : `no key authorization served for ${challenge.token}`
      }

      return dnsValues?.get(authz.identifier.value)?.includes(dns01Value(keyAuthorization)) ? null : 'TXT record not found'
    },
    ...options,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  prismaMock.tlsAcmeAccount.findUnique.mockResolvedValue(null)
})

describe('orderCertificate over HTTP-01', () => {
  it('runs the whole order and splits the bundle into leaf and chain', async () => {
    const ca = strictCa()
    const result = await order(ca, { domains: ['pcx.lab', 'www.pcx.lab'] })

    expect(result.certPem).toBe(LEAF_PEM)
    expect(result.chainPem).toBe(CHAIN_PEM)
    expect(() => createPrivateKey(result.keyPem)).not.toThrow()
    expect(ca.state.csrNames).toEqual(['pcx.lab', 'www.pcx.lab'])
  })

  it('serves every key authorization and removes it afterwards', async () => {
    const ca = strictCa()

    await order(ca, { domains: ['pcx.lab', 'www.pcx.lab'] })

    expect(challenges.putChallenge).toHaveBeenCalledTimes(2)
    expect(challenges.putChallenge).toHaveBeenCalledWith(expect.stringMatching(/http-01$/), expect.any(String), 'pcx.lab')
    expect(challenges.dropChallenge.mock.calls.map(([token]) => token).sort())
      .toEqual(challenges.putChallenge.mock.calls.map(([token]) => token).sort())
  })

  it('creates the account key once, stores it sealed and records the account URL', async () => {
    await order(strictCa())

    const stored = prismaMock.tlsAcmeAccount.create.mock.calls[0][0].data

    expect(stored).toMatchObject({ directoryUrl: DIRECTORY_URL, email: 'ops@pcx.lab' })
    expect(stored.keyEncrypted).not.toContain('PRIVATE KEY')
    expect(prismaMock.tlsAcmeAccount.update).toHaveBeenCalledWith({ where: { directoryUrl: DIRECTORY_URL }, data: { accountUrl: 'https://ca.test/acct/1' } })
  })

  it('reuses the stored key and leaves a known account URL alone', async () => {
    prismaMock.tlsAcmeAccount.findUnique.mockResolvedValue({ keyEncrypted: encryptSecret(generateAccountKeyPem()), accountUrl: 'https://ca.test/acct/1' })

    await order(strictCa())

    expect(prismaMock.tlsAcmeAccount.create).not.toHaveBeenCalled()
    expect(prismaMock.tlsAcmeAccount.update).not.toHaveBeenCalled()
  })

  it('skips an authorization the account already holds', async () => {
    await order(strictCa({ alreadyValid: ['pcx.lab'] }), { domains: ['pcx.lab', 'www.pcx.lab'] })

    expect(challenges.putChallenge).toHaveBeenCalledTimes(1)
    expect(challenges.putChallenge).toHaveBeenCalledWith(expect.any(String), expect.any(String), 'www.pcx.lab')
  })

  it('reports the reason the CA gives for a failed challenge, and still cleans up', async () => {
    const ca = createFakeCa({ validate: () => 'connection refused on port 80' })

    await expect(order(ca)).rejects.toThrow('pcx.lab: connection refused on port 80')
    expect(challenges.dropChallenge).toHaveBeenCalledTimes(1)
  })

  it('refuses when the CA does not offer the configured challenge type', async () => {
    await expect(order(strictCa({ offer: ['tls-alpn-01'] }))).rejects.toThrow('the CA offers no http-01 challenge for pcx.lab')
    expect(challenges.putChallenge).not.toHaveBeenCalled()
  })

  it('refuses an order with no domain rather than asking the CA', async () => {
    const ca = strictCa()

    await expect(order(ca, { domains: [] })).rejects.toThrow('at least one domain')
    expect(ca.state.requests).toEqual([])
  })
})

describe('orderCertificate over DNS-01', () => {
  it('publishes the digest at the base name of a wildcard and its apex, then removes both', async () => {
    const records = new Map<string, string[]>()
    const dns = {
      create: vi.fn(async (domain: string, value: string) => void records.set(domain, [...(records.get(domain) ?? []), value])),
      remove: vi.fn(async () => {}),
    }

    await order(strictCa({}, records), { domains: ['*.pcx.lab', 'pcx.lab'], challenge: 'dns-01', dns })

    expect(dns.create).toHaveBeenCalledTimes(2)
    expect(dns.create.mock.calls.every(([domain]) => domain === 'pcx.lab')).toBe(true)
    expect(dns.remove.mock.calls.map(([, value]) => value).sort()).toEqual(records.get('pcx.lab')!.sort())
    expect(challenges.putChallenge).not.toHaveBeenCalled()
  })

  it('refuses a DNS-01 order without handlers', async () => {
    await expect(order(strictCa(), { challenge: 'dns-01' })).rejects.toThrow('needs a DNS provider')
  })
})

describe('the ACME exchange', () => {
  it('sends the external account binding the CA requires', async () => {
    const eab = { kid: 'kid-1', hmacKey: Buffer.from('a shared secret of 32 bytes!!!!!').toString('base64url') }
    const ca = strictCa({ eab })

    await order(ca, { eab })

    expect(ca.state.eabChecked).toBe(true)
  })

  it('says so when the CA requires an external account binding and none is set', async () => {
    const ca = strictCa({ eab: { kid: 'kid-1', hmacKey: 'c2VjcmV0' } })

    await expect(order(ca)).rejects.toThrow('requires an external account binding')
  })

  it('retries once with the nonce of a badNonce answer', async () => {
    await expect(order(strictCa({ badNonces: 1 }))).resolves.toMatchObject({ certPem: LEAF_PEM })
  })

  it('waits as long as the CA asks between polls of a processing order', async () => {
    await order(strictCa({ processingPolls: { count: 2, retryAfter: '3' } }))

    expect(sleep).toHaveBeenCalledWith(3000)
    expect(sleep).toHaveBeenCalledTimes(2)
  })

  it('names the CA host when it cannot be reached', async () => {
    const timeout = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' })
    const unreachable = vi.fn(async () => { throw timeout }) as unknown as typeof fetch

    await expect(orderCertificate({ directoryUrl: DIRECTORY_URL, email: '', domains: ['pcx.lab'], eab: null, transport: { fetch: unreachable } }))
      .rejects.toThrow('ca.test unreachable (no answer within 60 s)')
  })
})
