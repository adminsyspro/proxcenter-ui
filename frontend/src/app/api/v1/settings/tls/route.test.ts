import { beforeEach, describe, expect, it, vi } from 'vitest'

// vi.mock is hoisted above this file's top-level `const` bindings, so the
// mock objects must come from vi.hoisted (same convention as
// src/lib/tls/store.test.ts) or the factories below read them while still in
// the TDZ.
const { guard, settingsLib, store, bootstrap, auditLib } = vi.hoisted(() => ({
  guard: { requireTlsAdmin: vi.fn() },
  settingsLib: { loadTlsSettings: vi.fn(), saveTlsSettings: vi.fn() },
  store: { getActiveSummary: vi.fn() },
  bootstrap: { applyActiveCertificate: vi.fn(async () => 'started') },
  auditLib: { audit: vi.fn() },
}))

vi.mock('@/lib/tls/guard', () => guard)
vi.mock('@/lib/tls/settings', () => settingsLib)
vi.mock('@/lib/tls/store', () => store)
vi.mock('@/lib/tls/bootstrap', () => bootstrap)
vi.mock('@/lib/audit', () => auditLib)

import { decryptSecret } from '@/lib/crypto/secret'
import { DEFAULT_TLS_SETTINGS } from '@/lib/tls/schema'
import { GET, PUT } from '@/app/api/v1/settings/tls/route'

beforeEach(() => {
  vi.clearAllMocks()
  guard.requireTlsAdmin.mockResolvedValue({ denied: null, userId: 'u1', userEmail: 'a@b.c' })
  settingsLib.loadTlsSettings.mockResolvedValue({ ...DEFAULT_TLS_SETTINGS })
  settingsLib.saveTlsSettings.mockImplementation(async (s: any) => s)
  store.getActiveSummary.mockResolvedValue(null)
  // clearAllMocks only clears calls, never implementations: a test that leaves
  // applyActiveCertificate hanging or rejecting would take the next one with
  // it, so the default is put back before every test.
  bootstrap.applyActiveCertificate.mockImplementation(async () => 'started')
  ;(globalThis as any).__proxcenterTls = { state: () => ({ listening: false, port: null, fingerprint: null, minVersion: null }) }
  process.env.APP_URL = 'https://pc.lab'
  process.env.NEXTAUTH_URL = 'https://pc.lab'
  process.env.APP_SECRET = 'route-test-secret'
})

describe('GET /api/v1/settings/tls', () => {
  it('hands back the guard refusal untouched', async () => {
    guard.requireTlsAdmin.mockResolvedValue({ denied: new Response('no', { status: 403 }) })

    expect((await GET()).status).toBe(403)
  })

  it('never returns the EAB HMAC key, only whether one is set', async () => {
    settingsLib.loadTlsSettings.mockResolvedValue({
      ...DEFAULT_TLS_SETTINGS,
      acme: { ...DEFAULT_TLS_SETTINGS.acme, eab: { kid: 'k', hmacKey: 'super-secret' } },
    })

    const body = await (await GET()).json()

    expect(JSON.stringify(body)).not.toContain('super-secret')
    expect(body.eabConfigured).toBe(true)
  })

  it('reports the URL coherence so the tab can block enabling', async () => {
    process.env.APP_URL = 'http://pc.lab'

    const body = await (await GET()).json()

    expect(body.urlCoherence.ok).toBe(false)
  })
})

function put(body: unknown) {
  return PUT(new Request('http://pc.lab/api/v1/settings/tls', { method: 'PUT', body: JSON.stringify(body) }))
}

describe('PUT /api/v1/settings/tls', () => {
  it('enables TLS even while the public URLs are still http, because that is the safe order', async () => {
    // The 409 that used to live here sent an HTTP install down the one path
    // that locks its operator out: switching APP_URL and NEXTAUTH_URL to https
    // and restarting hands out `secure` cookies a plain-HTTP browser will not
    // send, with no HTTPS listener yet to log in through. The listener goes on
    // first; the tab warns and says in which order to do the rest.
    process.env.APP_URL = 'http://pc.lab'

    const res = await put({ ...DEFAULT_TLS_SETTINGS, enabled: true })

    expect(res.status).toBe(200)
    expect(settingsLib.saveTlsSettings).toHaveBeenCalledWith(expect.objectContaining({ enabled: true }))
  })

  it('applies the listener right after a successful save', async () => {
    const res = await put({ ...DEFAULT_TLS_SETTINGS, enabled: true })

    expect(res.status).toBe(200)
    expect(bootstrap.applyActiveCertificate).toHaveBeenCalled()
  })

  describe('a listener teardown never waits for its own response', () => {
    /** Stands in for a stop() that hangs until the connection is destroyed. */
    function hangingApply() {
      bootstrap.applyActiveCertificate.mockImplementation(() => new Promise(() => {}))
    }

    beforeEach(() => {
      ;(globalThis as any).__proxcenterTls = {
        state: () => ({ listening: true, port: 8443, fingerprint: 'AA', minVersion: 'TLSv1.2' }),
      }
    })

    it('answers the disable request instead of dying with the listener', async () => {
      hangingApply()

      const res = await put({ ...DEFAULT_TLS_SETTINGS, enabled: false })

      expect(res.status).toBe(200)
      expect(bootstrap.applyActiveCertificate).toHaveBeenCalled()
    })

    it('answers a minimum-version change too: that one bounces the listener as well', async () => {
      hangingApply()

      const res = await put({ ...DEFAULT_TLS_SETTINGS, enabled: true, minVersion: 'TLSv1.3' })

      expect(res.status).toBe(200)
    })

    it('still awaits a change that leaves the listener up, so a failure surfaces', async () => {
      bootstrap.applyActiveCertificate.mockRejectedValue(new Error('cannot bind 8443'))
      const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

      const res = await put({ ...DEFAULT_TLS_SETTINGS, enabled: true, minVersion: 'TLSv1.2', redirectHttp: true })

      expect(res.status).toBe(500)
      consoleError.mockRestore()
    })
  })

  it('rejects a payload the schema refuses', async () => {
    expect((await put({ ...DEFAULT_TLS_SETTINGS, minVersion: 'SSLv3' })).status).toBe(400)
  })

  it('writes an audit row', async () => {
    await put({ ...DEFAULT_TLS_SETTINGS, enabled: true })

    expect(auditLib.audit).toHaveBeenCalledWith(expect.objectContaining({ action: 'tls.settings' }))
  })

  describe('order outcome and backoff are the server\'s', () => {
    const issued = {
      ...DEFAULT_TLS_SETTINGS,
      source: 'acme' as const,
      acme: { ...DEFAULT_TLS_SETTINGS.acme, directoryUrl: 'https://ca.lab/dir', domains: ['pc.lab'] },
      order: { status: 'ok' as const, step: 'done', startedAt: '2026-10-24T08:50:00Z', finishedAt: '2026-10-24T08:50:36Z', message: null },
      failureCount: 2,
    }

    beforeEach(() => settingsLib.loadTlsSettings.mockResolvedValue(issued))

    const saved = () => settingsLib.saveTlsSettings.mock.calls[0][0]

    it('keeps the stored outcome over the stale copy a tab sends back', async () => {
      await put({ ...issued, hsts: { ...issued.hsts, enabled: true }, order: DEFAULT_TLS_SETTINGS.order, failureCount: 0 })

      expect(saved().order).toEqual(issued.order)
      expect(saved().failureCount).toBe(2)
    })

    it.each([
      ['the CA', { directoryUrl: DEFAULT_TLS_SETTINGS.acme.directoryUrl }],
      ['the validation method', { challenge: 'dns-01' as const }],
      ['the names', { domains: ['pc.lab', 'www.pc.lab'] }],
    ])('clears the outcome once %s changes, since it no longer describes the setup', async (_label, acme) => {
      await put({ ...issued, acme: { ...issued.acme, ...acme } })

      expect(saved().order).toEqual(DEFAULT_TLS_SETTINGS.order)
      expect(saved().failureCount).toBe(0)
    })

    it('leaves a running order alone even when the CA changes', async () => {
      const running = { ...issued, order: { ...issued.order, status: 'pending' as const, finishedAt: null } }

      settingsLib.loadTlsSettings.mockResolvedValue(running)
      await put({ ...running, acme: { ...running.acme, directoryUrl: DEFAULT_TLS_SETTINGS.acme.directoryUrl } })

      expect(saved().order).toEqual(running.order)
    })

    it('records the CA in the audit row', async () => {
      await put(issued)

      expect(auditLib.audit).toHaveBeenCalledWith(expect.objectContaining({
        details: expect.objectContaining({ directoryUrl: 'https://ca.lab/dir' }),
      }))
    })
  })

  describe('the EAB secret survives a round-trip without freezing the kid', () => {
    const stored = {
      ...DEFAULT_TLS_SETTINGS,
      acme: { ...DEFAULT_TLS_SETTINGS.acme, eab: { kid: 'old-kid', hmacKey: 'super-secret' } },
    }

    beforeEach(() => settingsLib.loadTlsSettings.mockResolvedValue(stored))

    function savedEab() {
      return settingsLib.saveTlsSettings.mock.calls[0][0].acme.eab
    }

    it('keeps the stored key when the form sends it back blank', async () => {
      await put({ ...stored, acme: { ...stored.acme, eab: { kid: 'old-kid', hmacKey: '' } } })

      expect(savedEab()).toEqual({ kid: 'old-kid', hmacKey: 'super-secret' })
    })

    it('keeps a kid the operator edited, instead of reverting it', async () => {
      // GET always blanks the key, so EVERY ordinary round-trip goes down the
      // substitution branch. Substituting the whole eab object put the stored
      // kid back and silently threw the edit away.
      await put({ ...stored, acme: { ...stored.acme, eab: { kid: 'new-kid', hmacKey: '' } } })

      expect(savedEab()).toEqual({ kid: 'new-kid', hmacKey: 'super-secret' })
    })

    it('takes a new key when one is actually supplied, sealed before it is stored', async () => {
      await put({ ...stored, acme: { ...stored.acme, eab: { kid: 'new-kid', hmacKey: 'rotated' } } })

      expect(savedEab().kid).toBe('new-kid')
      expect(savedEab().hmacKey).not.toContain('rotated')
      expect(decryptSecret(savedEab().hmacKey)).toBe('rotated')
    })

    it('lets EAB be removed outright', async () => {
      await put({ ...stored, acme: { ...stored.acme, eab: null } })

      expect(savedEab()).toBeNull()
    })

    it('refuses a blank key when there is no stored one to keep', async () => {
      settingsLib.loadTlsSettings.mockResolvedValue({ ...DEFAULT_TLS_SETTINGS })

      const res = await put({
        ...DEFAULT_TLS_SETTINGS,
        acme: { ...DEFAULT_TLS_SETTINGS.acme, eab: { kid: 'k', hmacKey: '' } },
      })

      expect(res.status).toBe(400)
      expect(settingsLib.saveTlsSettings).not.toHaveBeenCalled()
    })
  })
})

describe('DNS-01 provider credentials', () => {
  const sealedToken = 'iv.tag.sealed-token'
  const stored = {
    ...DEFAULT_TLS_SETTINGS,
    acme: {
      ...DEFAULT_TLS_SETTINGS.acme,
      challenge: 'dns-01' as const,
      dns: { provider: 'acmedns' as const, credentials: { password: sealedToken }, validationDelaySeconds: 30 },
    },
  }

  beforeEach(() => settingsLib.loadTlsSettings.mockResolvedValue(stored))

  function savedDns() {
    return settingsLib.saveTlsSettings.mock.calls[0][0].acme.dns
  }

  it('GET blanks every secret field and says which ones are set', async () => {
    const body = await (await GET()).json()

    expect(JSON.stringify(body)).not.toContain(sealedToken)
    expect(body.settings.acme.dns.credentials.password).toBe('')
    expect(body.dnsSecretsConfigured).toEqual(['password'])
  })

  it('keeps the stored token when the form sends it back blank', async () => {
    await put({ ...stored, acme: { ...stored.acme, dns: { ...stored.acme.dns, credentials: { password: '' } } } })

    expect(savedDns().credentials).toEqual({ password: sealedToken })
  })

  it('seals a new token and never stores it in clear', async () => {
    await put({ ...stored, acme: { ...stored.acme, dns: { ...stored.acme.dns, credentials: { password: ' fresh ' } } } })

    expect(savedDns().credentials.password).not.toContain('fresh')
    expect(decryptSecret(savedDns().credentials.password)).toBe('fresh')
  })

  it('starts from a blank sheet when the provider changes, keeping plain fields in clear', async () => {
    await put({
      ...stored,
      acme: {
        ...stored.acme,
        dns: { ...stored.acme.dns, provider: 'powerdns', credentials: { password: '', apiUrl: 'http://pdns:8081', apiKey: '' } },
      },
    })

    expect(savedDns()).toMatchObject({ provider: 'powerdns', credentials: { apiUrl: 'http://pdns:8081' } })
    expect(savedDns().credentials).not.toHaveProperty('password')
    expect(savedDns().credentials).not.toHaveProperty('apiKey')
  })

  it('drops fields the provider does not declare', async () => {
    await put({ ...stored, acme: { ...stored.acme, dns: { ...stored.acme.dns, credentials: { password: '', injected: 'x' } } } })

    expect(savedDns().credentials).not.toHaveProperty('injected')
  })
})
