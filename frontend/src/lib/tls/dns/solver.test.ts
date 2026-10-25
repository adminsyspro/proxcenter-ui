import { beforeEach, describe, expect, it, vi } from 'vitest'

const { registry, propagation, provider } = vi.hoisted(() => {
  const provider = { addTxtRecord: vi.fn(), removeTxtRecord: vi.fn(), checkAccess: vi.fn() }

  return {
    provider,
    registry: { DNS_PROVIDER_FACTORIES: { powerdns: vi.fn(() => provider), acmedns: vi.fn(() => provider) } },
    propagation: { waitForTxtPropagation: vi.fn() },
  }
})

vi.mock('@/lib/tls/dns/registry', () => registry)
vi.mock('@/lib/tls/dns/propagation', () => propagation)

import { encryptSecret } from '@/lib/crypto/secret'
import { checkDnsAccess, createDnsChallengeHandlers } from '@/lib/tls/dns/solver'
import { DEFAULT_TLS_SETTINGS, type TlsSettings } from '@/lib/tls/schema'

function settingsWith(dns: Partial<TlsSettings['acme']['dns']>): TlsSettings {
  return {
    ...DEFAULT_TLS_SETTINGS,
    acme: { ...DEFAULT_TLS_SETTINGS.acme, challenge: 'dns-01', dns: { ...DEFAULT_TLS_SETTINGS.acme.dns, ...dns } },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  process.env.APP_SECRET = 'solver-test-secret'
  provider.addTxtRecord.mockResolvedValue(undefined)
  provider.removeTxtRecord.mockResolvedValue(undefined)
  provider.checkAccess.mockResolvedValue(undefined)
  propagation.waitForTxtPropagation.mockResolvedValue('confirmed')
})

describe('createDnsChallengeHandlers', () => {
  it('hands the provider the opened secrets, never the sealed form', () => {
    createDnsChallengeHandlers(settingsWith({ provider: 'powerdns', credentials: { apiUrl: 'http://pdns:8081', apiKey: encryptSecret('tok') } }))

    expect(registry.DNS_PROVIDER_FACTORIES.powerdns).toHaveBeenCalledWith({ apiUrl: 'http://pdns:8081', apiKey: 'tok' }, expect.any(Object))
  })

  it('publishes at the challenge name, waits for the authoritative servers, then the operator delay', async () => {
    const sleep = vi.fn(async () => {})
    const handlers = createDnsChallengeHandlers(
      settingsWith({ provider: 'powerdns', credentials: { apiUrl: 'http://pdns:8081', apiKey: encryptSecret('tok') }, validationDelaySeconds: 7 }),
      { sleep },
    )

    await handlers.create('*.example.com', 'digest')

    expect(provider.addTxtRecord).toHaveBeenCalledWith('_acme-challenge.example.com', 'digest')
    expect(propagation.waitForTxtPropagation).toHaveBeenCalledWith('_acme-challenge.example.com', 'digest', expect.any(Object))
    expect(sleep).toHaveBeenCalledWith(7000)
  })

  it('still orders, on the delay alone, when propagation cannot be checked from here', async () => {
    propagation.waitForTxtPropagation.mockResolvedValue('unverifiable')
    const log = vi.fn()
    const handlers = createDnsChallengeHandlers(
      settingsWith({ provider: 'powerdns', credentials: { apiUrl: 'http://pdns:8081', apiKey: encryptSecret('tok') } }),
      { sleep: async () => {}, log },
    )

    await expect(handlers.create('example.com', 'd')).resolves.toBeUndefined()
    expect(log).toHaveBeenCalledWith(expect.stringContaining('validation delay'))
  })

  it('serializes writes so a wildcard and its apex never race on one record set', async () => {
    let inFlight = 0
    let peak = 0

    provider.addTxtRecord.mockImplementation(async () => {
      peak = Math.max(peak, ++inFlight)
      await new Promise(resolve => setTimeout(resolve, 5))
      inFlight--
    })

    const handlers = createDnsChallengeHandlers(
      settingsWith({ provider: 'powerdns', credentials: { apiUrl: 'http://pdns:8081', apiKey: encryptSecret('tok') }, validationDelaySeconds: 0 }),
    )

    await Promise.all([handlers.create('example.com', 'a'), handlers.create('*.example.com', 'b')])

    expect(peak).toBe(1)
    expect(provider.addTxtRecord).toHaveBeenCalledTimes(2)
  })

  it('keeps serving the queue after one write fails', async () => {
    provider.removeTxtRecord.mockRejectedValueOnce(new Error('boom'))

    const handlers = createDnsChallengeHandlers(settingsWith({ provider: 'powerdns', credentials: { apiUrl: 'http://pdns:8081', apiKey: encryptSecret('tok') } }))

    await expect(handlers.remove('example.com', 'a')).rejects.toThrow('boom')
    await expect(handlers.remove('example.com', 'b')).resolves.toBeUndefined()
  })

  it('refuses up front when a required field is missing or no provider is chosen', () => {
    expect(() => createDnsChallengeHandlers(settingsWith({ provider: 'acmedns', credentials: { apiUrl: 'https://auth.example.com' } }))).toThrow(
      'acme-dns: missing username, password, subdomain',
    )
    expect(() => createDnsChallengeHandlers(settingsWith({ provider: null }))).toThrow('no DNS provider selected')
  })
})

describe('checkDnsAccess', () => {
  it('reports each domain the credentials cannot manage', async () => {
    provider.checkAccess.mockImplementation(async (fqdn: string) => {
      if (fqdn === '_acme-challenge.pc.other.org') throw new Error('no zone')
    })

    const result = await checkDnsAccess(
      settingsWith({ provider: 'powerdns', credentials: { apiUrl: 'http://pdns:8081', apiKey: encryptSecret('tok') } }),
      ['pc.example.com', 'pc.other.org'],
    )

    expect(result).toEqual({ ok: false, failures: [{ domain: 'pc.other.org', reason: 'no zone' }] })
  })

  it('turns a configuration error into one failure per domain instead of throwing', async () => {
    const result = await checkDnsAccess(settingsWith({ provider: null }), ['a.example.com'])

    expect(result.ok).toBe(false)
    expect(result.failures[0]).toMatchObject({ domain: 'a.example.com', reason: expect.stringContaining('no DNS provider') })
  })
})
