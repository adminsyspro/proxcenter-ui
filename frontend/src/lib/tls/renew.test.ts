import { beforeEach, describe, expect, it, vi } from 'vitest'

// vi.mock is hoisted above this file's top-level bindings, so the mock objects
// come from vi.hoisted (same convention as src/lib/tls/store.test.ts).
const { acmeLib, storeLib, settingsLib, bootstrapLib, preflightLib, auditLib, solverLib } = vi.hoisted(() => ({
  solverLib: { checkDnsAccess: vi.fn(), createDnsChallengeHandlers: vi.fn(() => ({ create: vi.fn(), remove: vi.fn() })) },
  acmeLib: { orderCertificate: vi.fn() },
  storeLib: { saveCertificate: vi.fn() },
  settingsLib: { loadTlsSettings: vi.fn(), saveTlsSettings: vi.fn() },
  bootstrapLib: { applyActiveCertificate: vi.fn() },
  preflightLib: { preflightHttp01: vi.fn() },
  auditLib: { audit: vi.fn() },
}))

vi.mock('@/lib/tls/acme', () => acmeLib)
vi.mock('@/lib/tls/store', () => storeLib)
vi.mock('@/lib/tls/settings', () => settingsLib)
vi.mock('@/lib/tls/bootstrap', () => bootstrapLib)
vi.mock('@/lib/tls/preflight', () => preflightLib)
vi.mock('@/lib/audit', () => auditLib)
vi.mock('@/lib/tls/dns/solver', () => solverLib)

import { encryptSecret } from '@/lib/crypto/secret'
import { DEFAULT_TLS_SETTINGS } from '@/lib/tls/schema'
import { isOrderRunning, nextBackoff, runAcmeOrder, shouldRenew } from '@/lib/tls/renew'

const now = new Date('2026-09-17T12:00:00Z')

function inDays(days: number) {
  return new Date(now.getTime() + days * 86_400_000)
}

// DEFAULT_TLS_SETTINGS.acme.domains is [], and shouldRenew refuses to order for
// an install that has no domain yet. A fixture spreading the defaults as-is
// would therefore answer false for reasons that have nothing to do with the
// case under test, so every case below starts from a configuration that is
// actually complete.
const acme = {
  ...DEFAULT_TLS_SETTINGS,
  enabled: true,
  source: 'acme' as const,
  acme: { ...DEFAULT_TLS_SETTINGS.acme, domains: ['pcx.lab'] },
}

describe('shouldRenew', () => {
  it('renews inside the window', () => {
    expect(shouldRenew(acme, { source: 'acme', notAfter: inDays(10) }, now)).toBe(true)
  })

  it('leaves a certificate alone outside the window', () => {
    expect(shouldRenew(acme, { source: 'acme', notAfter: inDays(60) }, now)).toBe(false)
  })

  it('renews an already expired certificate', () => {
    expect(shouldRenew(acme, { source: 'acme', notAfter: inDays(-1) }, now)).toBe(true)
  })

  it('never renews an uploaded certificate: no CA to ask', () => {
    expect(shouldRenew(acme, { source: 'uploaded', notAfter: inDays(1) }, now)).toBe(false)
  })

  it('never renews a self-signed one either', () => {
    expect(shouldRenew(acme, { source: 'self_signed', notAfter: inDays(1) }, now)).toBe(false)
  })

  it('does nothing while the source setting is not acme', () => {
    expect(shouldRenew({ ...acme, source: 'uploaded' }, { source: 'acme', notAfter: inDays(1) }, now)).toBe(false)
  })

  it('does nothing while TLS is disabled', () => {
    expect(shouldRenew({ ...acme, enabled: false }, { source: 'acme', notAfter: inDays(1) }, now)).toBe(false)
  })

  it('waits for nextAttemptAt after a failure', () => {
    const backedOff = { ...acme, failureCount: 2, nextAttemptAt: inDays(0.5).toISOString() }

    expect(shouldRenew(backedOff, { source: 'acme', notAfter: inDays(1) }, now)).toBe(false)
  })

  it('orders when there is no certificate at all', () => {
    expect(shouldRenew(acme, null, now)).toBe(true)
  })

  it('stays put while no domain is configured, rather than failing an order every hour', () => {
    const noDomain = { ...acme, acme: { ...acme.acme, domains: [] } }

    expect(shouldRenew(noDomain, null, now)).toBe(false)
    expect(shouldRenew(noDomain, { source: 'acme', notAfter: inDays(1) }, now)).toBe(false)
  })
})

describe('nextBackoff', () => {
  it('grows with the failure count', () => {
    expect(nextBackoff(1, now).getTime()).toBeLessThan(nextBackoff(3, now).getTime())
  })

  it('caps at one hour, the Let’s Encrypt failure budget', () => {
    expect(nextBackoff(50, now).getTime() - now.getTime()).toBeLessThanOrEqual(3_600_000)
  })
})

describe('runAcmeOrder and the renewal lease', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    settingsLib.loadTlsSettings.mockResolvedValue({ ...acme })
    settingsLib.saveTlsSettings.mockImplementation(async (next: any) => next)
    preflightLib.preflightHttp01.mockResolvedValue({ ok: true, failures: [] })
    acmeLib.orderCertificate.mockResolvedValue({ certPem: 'c', chainPem: null, keyPem: 'k' })
    storeLib.saveCertificate.mockResolvedValue({
      id: 'cert-1',
      commonName: 'pcx.lab',
      sanNames: ['pcx.lab'],
      notAfter: new Date('2027-01-01T00:00:00Z'),
      fingerprint: 'AA',
    })
  })

  it('writes and activates the certificate on the happy path', async () => {
    await expect(runAcmeOrder('renewal')).resolves.toEqual({ ok: true })
    expect(storeLib.saveCertificate).toHaveBeenCalledWith(expect.objectContaining({ source: 'acme', activate: true }))
  })

  it('never writes a certificate once the lease has gone to another replica', async () => {
    // The ACME client has no request timeout, so an order can outlive its
    // lease. Publishing after a neighbour has taken over is the overlap the
    // lease exists to prevent, so the last gate before the write has to hold.
    const assertStillEntitled = vi.fn(() => { throw new Error('lease lost') })

    const result = await runAcmeOrder('renewal', { assertStillEntitled })

    expect(assertStillEntitled).toHaveBeenCalled()
    expect(result.ok).toBe(false)
    expect(storeLib.saveCertificate).not.toHaveBeenCalled()
    expect(bootstrapLib.applyActiveCertificate).not.toHaveBeenCalled()
  })

  it('records the lost lease as an ordinary failure, with backoff and an audit row', async () => {
    await runAcmeOrder('renewal', { assertStillEntitled: () => { throw new Error('lease lost') } })

    expect(auditLib.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'tls.issue', status: 'failure' }))
    expect(settingsLib.saveTlsSettings).toHaveBeenCalledWith(
      expect.objectContaining({ failureCount: 1, nextAttemptAt: expect.any(String) }),
    )
  })

  describe('an order in flight writes its own four fields and nothing else', () => {
    /**
     * A settings row that actually behaves like one: load reads what save
     * wrote. With a fixed mockResolvedValue the bug under test is invisible,
     * because every load hands back the same snapshot.
     */
    function liveRow(initial: any) {
      let row = { ...initial }

      settingsLib.loadTlsSettings.mockImplementation(async () => ({ ...row }))
      settingsLib.saveTlsSettings.mockImplementation(async (next: any) => {
        row = { ...next }

        return { ...row }
      })

      return { read: () => row, edit: (patch: any) => { row = { ...row, ...patch } } }
    }

    it('keeps a minimum version raised while the order was running', async () => {
      const store = liveRow(acme)

      // The operator raises the floor to TLS 1.3 from the settings tab while
      // the CA is still working. Completing the order used to write back the
      // snapshot captured before it started and silently undo that.
      acmeLib.orderCertificate.mockImplementation(async () => {
        store.edit({ minVersion: 'TLSv1.3' })

        return { certPem: 'c', chainPem: null, keyPem: 'k' }
      })

      await expect(runAcmeOrder('renewal')).resolves.toEqual({ ok: true })

      expect(store.read().minVersion).toBe('TLSv1.3')
      expect(store.read().order.status).toBe('ok')
    })

    it('keeps HTTPS disabled mid-order, even when the order then fails', async () => {
      const store = liveRow(acme)

      acmeLib.orderCertificate.mockImplementation(async () => {
        store.edit({ enabled: false })
        throw new Error('the CA rejected the order')
      })

      const result = await runAcmeOrder('manual')

      expect(result.ok).toBe(false)
      expect(store.read().enabled).toBe(false)
      expect(store.read().failureCount).toBe(1)
      expect(store.read().order.status).toBe('error')
    })
  })

  it('still refuses an order with no domain, whatever the lease says', async () => {
    settingsLib.loadTlsSettings.mockResolvedValue({ ...acme, acme: { ...acme.acme, domains: [] } })

    const result = await runAcmeOrder('manual')

    expect(result.ok).toBe(false)
    expect(acmeLib.orderCertificate).not.toHaveBeenCalled()
  })
})

describe('isOrderRunning', () => {
  const now = new Date('2026-09-17T12:00:00Z')

  function pending(startedAt: string | null) {
    return { status: 'pending' as const, step: 'order', startedAt, finishedAt: null, message: null }
  }

  it('is true for an order started a moment ago', () => {
    expect(isOrderRunning(pending('2026-09-17T11:59:00Z'), now)).toBe(true)
  })

  it('is false past the lease ceiling: nobody is running that order any more', () => {
    expect(isOrderRunning(pending('2026-09-17T11:00:00Z'), now)).toBe(false)
  })

  it('is false for every status but pending', () => {
    expect(isOrderRunning({ ...pending('2026-09-17T11:59:00Z'), status: 'ok' }, now)).toBe(false)
    expect(isOrderRunning(DEFAULT_TLS_SETTINGS.order, now)).toBe(false)
  })

  it('is false for a pending row with no usable start time, rather than wedging on it', () => {
    expect(isOrderRunning(pending(null), now)).toBe(false)
    expect(isOrderRunning(pending('not a date'), now)).toBe(false)
  })
})

describe('runAcmeOrder over DNS-01', () => {
  const dns01 = {
    ...acme,
    acme: {
      ...acme.acme,
      domains: ['*.pcx.lab'],
      challenge: 'dns-01' as const,
      dns: { provider: 'powerdns' as const, credentials: { apiUrl: 'http://pdns:8081', apiKey: 'sealed' }, validationDelaySeconds: 0 },
    },
  }

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.APP_SECRET ||= 'renew-test-secret'
    settingsLib.loadTlsSettings.mockResolvedValue(dns01)
    settingsLib.saveTlsSettings.mockImplementation(async (next: any) => next)
    solverLib.checkDnsAccess.mockResolvedValue({ ok: true, failures: [] })
    acmeLib.orderCertificate.mockResolvedValue({ certPem: 'c', chainPem: null, keyPem: 'k' })
    storeLib.saveCertificate.mockResolvedValue({
      id: 'cert-1', commonName: '*.pcx.lab', sanNames: ['*.pcx.lab'], notAfter: new Date('2027-01-01T00:00:00Z'), fingerprint: 'AA',
    })
  })

  it('checks the zone with the provider instead of probing port 80, then orders over DNS-01', async () => {
    await expect(runAcmeOrder('manual')).resolves.toEqual({ ok: true })

    expect(preflightLib.preflightHttp01).not.toHaveBeenCalled()
    expect(solverLib.checkDnsAccess).toHaveBeenCalledWith(dns01, ['*.pcx.lab'])
    expect(acmeLib.orderCertificate).toHaveBeenCalledWith(expect.objectContaining({ challenge: 'dns-01', dns: expect.any(Object) }))
    expect(auditLib.audit).toHaveBeenCalledWith(expect.objectContaining({
      status: 'success', details: expect.objectContaining({ challenge: 'dns-01', dnsProvider: 'powerdns' }),
    }))
  })

  it('stops before the CA when the credentials cannot manage a zone', async () => {
    solverLib.checkDnsAccess.mockResolvedValue({ ok: false, failures: [{ domain: '*.pcx.lab', reason: 'no zone' }] })

    await expect(runAcmeOrder('manual')).resolves.toEqual({ ok: false, message: '*.pcx.lab: no zone' })
    expect(acmeLib.orderCertificate).not.toHaveBeenCalled()
  })

  it('opens the sealed EAB key only to hand it to the ACME client', async () => {
    settingsLib.loadTlsSettings.mockResolvedValue({ ...dns01, acme: { ...dns01.acme, eab: { kid: 'kid', hmacKey: encryptSecret('hmac') } } })

    await runAcmeOrder('manual')

    expect(acmeLib.orderCertificate).toHaveBeenCalledWith(expect.objectContaining({ eab: { kid: 'kid', hmacKey: 'hmac' } }))
  })
})
