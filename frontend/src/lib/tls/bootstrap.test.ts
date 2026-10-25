import { createHash } from 'node:crypto'

import { beforeEach, describe, expect, it, vi } from 'vitest'

// vi.mock is hoisted above this file's top-level `const` bindings, so the
// mock objects themselves must come from vi.hoisted (same convention as
// src/lib/vdc/context.test.ts and src/lib/tls/store.test.ts) or the factory
// below reads `store`/`settings` while they are still in the TDZ.
const { store, settings } = vi.hoisted(() => ({
  store: {
    countCertificates: vi.fn(),
    saveCertificate: vi.fn(),
    loadActiveMaterial: vi.fn(),
  },
  settings: { loadTlsSettings: vi.fn(), saveTlsSettings: vi.fn() },
}))

vi.mock('@/lib/tls/store', () => store)
vi.mock('@/lib/tls/settings', () => settings)

import { DEFAULT_TLS_SETTINGS } from '@/lib/tls/schema'
import { applyActiveCertificate, startTlsListener } from '@/lib/tls/bootstrap'

// The listener's own view of what it is serving. DEFAULT_TLS_SETTINGS pins
// TLSv1.2, and loadActiveMaterial below hands back the chainless certificate
// 'c', so UP is "already exactly in line with the database". servedFingerprint
// is the digest of exactly what start.js passes as `cert`, computed here the
// same way rather than copied, so these fixtures cannot drift from the module.
function servedDigest(certPem: string, chainPem: string | null) {
  return createHash('sha256').update(chainPem ? `${certPem}\n${chainPem}` : certPem).digest('hex')
}

const DOWN = { listening: false, port: null, fingerprint: null, servedFingerprint: null, minVersion: null } as const
const UP = {
  listening: true,
  port: 8443,
  fingerprint: 'AA',
  servedFingerprint: servedDigest('c', null),
  minVersion: 'TLSv1.2',
} as const

const controller = {
  start: vi.fn(async () => {}),
  reload: vi.fn(),
  stop: vi.fn(async () => {}),
  setHttpPolicy: vi.fn(),
  state: vi.fn(() => ({ listening: false, port: null, fingerprint: null, servedFingerprint: null, minVersion: null })),
}

beforeEach(() => {
  vi.clearAllMocks()
  ;(globalThis as any).__proxcenterTls = controller
  store.countCertificates.mockResolvedValue(1)
  settings.loadTlsSettings.mockResolvedValue({ ...DEFAULT_TLS_SETTINGS, enabled: true })
  store.loadActiveMaterial.mockResolvedValue({ id: 'c1', fingerprint: 'AA', certPem: 'c', chainPem: null, keyPem: 'k' })
})

describe('startTlsListener', () => {
  it('generates a self-signed certificate on a database that has none', async () => {
    store.countCertificates.mockResolvedValue(0)
    store.saveCertificate.mockResolvedValue({ id: 'c0' })

    await startTlsListener()

    expect(store.saveCertificate).toHaveBeenCalledWith(expect.objectContaining({ source: 'self_signed', activate: true }))
  })

  it('leaves an existing install alone: no generation when a certificate is already there', async () => {
    await startTlsListener()

    expect(store.saveCertificate).not.toHaveBeenCalled()
  })

  it('does nothing at all in demo mode', async () => {
    process.env.DEMO_MODE = 'true'

    await startTlsListener()

    expect(controller.start).not.toHaveBeenCalled()
    delete process.env.DEMO_MODE
  })

  it('never lets a TLS failure take the boot down', async () => {
    settings.loadTlsSettings.mockRejectedValue(new Error('database is on fire'))

    await expect(startTlsListener()).resolves.toBeUndefined()
  })

  it('never lets a TLS failure take the boot down when start() itself rejects', async () => {
    // mockRejectedValueOnce, not mockRejectedValue: the latter overwrites the
    // mock's implementation for every later test too, since clearAllMocks()
    // in beforeEach clears call history but not implementations.
    controller.start.mockRejectedValueOnce(new Error('EADDRINUSE'))

    await expect(startTlsListener()).resolves.toBeUndefined()
  })
})

describe('applyActiveCertificate', () => {
  it('starts the listener when TLS is enabled and nothing is listening', async () => {
    await expect(applyActiveCertificate()).resolves.toBe('started')
    expect(controller.start).toHaveBeenCalledWith(expect.objectContaining({ fingerprint: 'AA', port: 8443 }))
  })

  it('reloads when the active fingerprint moved under a running listener', async () => {
    controller.state.mockReturnValue({ ...UP, fingerprint: 'OLD', servedFingerprint: 'OLD-BUNDLE' })

    await expect(applyActiveCertificate()).resolves.toBe('reloaded')
    expect(controller.reload).toHaveBeenCalledWith(expect.objectContaining({ fingerprint: 'AA' }))
  })

  it('does nothing when the running fingerprint already matches', async () => {
    controller.state.mockReturnValue({ ...UP })

    await expect(applyActiveCertificate()).resolves.toBe('unchanged')
    expect(controller.reload).not.toHaveBeenCalled()
  })

  it('stops the listener when TLS gets turned off', async () => {
    controller.state.mockReturnValue({ ...UP })
    settings.loadTlsSettings.mockResolvedValue({ ...DEFAULT_TLS_SETTINGS, enabled: false })

    await expect(applyActiveCertificate()).resolves.toBe('stopped')
    expect(controller.stop).toHaveBeenCalled()
  })

  it('propagates a failed start() rather than reporting the listener as up', async () => {
    // A previous test in this block left state() overridden to "listening";
    // put it back to "nothing listening" so this one actually reaches
    // ctl.start() instead of short-circuiting to 'unchanged'.
    controller.state.mockReturnValue({ ...DOWN })
    // mockRejectedValueOnce for the same reason as the startTlsListener case
    // above: a plain mockRejectedValue would leak into every test that runs
    // after this one in the file.
    controller.start.mockRejectedValueOnce(new Error('EADDRINUSE'))

    await expect(applyActiveCertificate()).rejects.toThrow('EADDRINUSE')
    expect(controller.state).toHaveBeenCalled()
  })
})

describe('the HTTP policy follows the listener, never the other way round', () => {
  const redirecting = { ...DEFAULT_TLS_SETTINGS, enabled: true, redirectHttp: true }

  function lastPolicy() {
    const calls = controller.setHttpPolicy.mock.calls

    return calls[calls.length - 1]?.[0]
  }

  it('leaves the redirect off when the listener fails to bind', async () => {
    controller.state.mockReturnValue({ ...DOWN })
    settings.loadTlsSettings.mockResolvedValue(redirecting)
    controller.start.mockRejectedValueOnce(new Error('EADDRINUSE'))

    await expect(applyActiveCertificate()).rejects.toThrow('EADDRINUSE')

    // Otherwise every plain-HTTP request is bounced to a dead port and the
    // operator has no way back into the appliance.
    expect(lastPolicy()).toMatchObject({ redirect: false })
  })

  it('applies the configured redirect once the listener is confirmed up', async () => {
    controller.state.mockReturnValue({ ...DOWN })
    settings.loadTlsSettings.mockResolvedValue(redirecting)

    await expect(applyActiveCertificate()).resolves.toBe('started')
    expect(lastPolicy()).toMatchObject({ redirect: true })
  })

  it('leaves the redirect off when there is no certificate to serve', async () => {
    controller.state.mockReturnValue({ ...DOWN })
    settings.loadTlsSettings.mockResolvedValue(redirecting)
    store.loadActiveMaterial.mockResolvedValue(null)

    await expect(applyActiveCertificate()).resolves.toBe('idle')
    expect(lastPolicy()).toMatchObject({ redirect: false })
  })

  it('drops the redirect when TLS is turned off', async () => {
    controller.state.mockReturnValue({ ...UP })
    settings.loadTlsSettings.mockResolvedValue({ ...redirecting, enabled: false })

    await expect(applyActiveCertificate()).resolves.toBe('stopped')
    expect(lastPolicy()).toMatchObject({ redirect: false })
  })
})

describe('reconciliation covers everything that decides the served configuration', () => {
  it('restarts the listener when the minimum TLS version is raised', async () => {
    controller.state.mockReturnValue({ ...UP, minVersion: 'TLSv1.2' })
    settings.loadTlsSettings.mockResolvedValue({ ...DEFAULT_TLS_SETTINGS, enabled: true, minVersion: 'TLSv1.3' })

    await expect(applyActiveCertificate()).resolves.toBe('restarted')
    expect(controller.stop).toHaveBeenCalled()
    expect(controller.start).toHaveBeenCalledWith(expect.objectContaining({ minVersion: 'TLSv1.3' }))
    // setSecureContext does not move the protocol floor, so a reload here
    // would leave TLS 1.2 accepted while the settings page claims 1.3.
    expect(controller.reload).not.toHaveBeenCalled()
  })

  it('reloads when the chain changed under an unchanged leaf', async () => {
    controller.state.mockReturnValue({ ...UP, servedFingerprint: 'stale-bundle-digest' })
    store.loadActiveMaterial.mockResolvedValue({
      id: 'c1',
      fingerprint: 'AA',
      chainPem: '-----BEGIN CERTIFICATE-----corrected-----END CERTIFICATE-----',
      certPem: 'c',
      keyPem: 'k',
    })

    await expect(applyActiveCertificate()).resolves.toBe('reloaded')
    expect(controller.reload).toHaveBeenCalledWith(
      expect.objectContaining({ fingerprint: 'AA', servedFingerprint: expect.stringMatching(/^[0-9a-f]{64}$/) }),
    )
  })

  it('reloads when intermediates bundled in the certificate field changed, with chainPem null throughout', async () => {
    // The residual half of this defect: an operator who pastes
    // leaf-plus-intermediates into the certificate field alone leaves chainPem
    // null, so two bundles with the same leaf and different issuers used to
    // compare equal and the listener was never reloaded.
    const leaf = '-----BEGIN CERTIFICATE-----leaf-----END CERTIFICATE-----'
    const first = `${leaf}\n-----BEGIN CERTIFICATE-----issuer-one-----END CERTIFICATE-----`
    const second = `${leaf}\n-----BEGIN CERTIFICATE-----issuer-two-----END CERTIFICATE-----`

    controller.state.mockReturnValue({ ...UP, servedFingerprint: servedDigest(first, null) })
    store.loadActiveMaterial.mockResolvedValue({
      id: 'c1',
      fingerprint: 'AA',
      certPem: second,
      chainPem: null,
      keyPem: 'k',
    })

    await expect(applyActiveCertificate()).resolves.toBe('reloaded')
    expect(controller.reload).toHaveBeenCalledWith(
      expect.objectContaining({ chainPem: null, servedFingerprint: servedDigest(second, null) }),
    )
  })

  it('still does nothing when the same bundled certificate comes back', async () => {
    const bundle = '-----BEGIN CERTIFICATE-----leaf-----END CERTIFICATE-----\n-----BEGIN CERTIFICATE-----ca-----END CERTIFICATE-----'

    controller.state.mockReturnValue({ ...UP, servedFingerprint: servedDigest(bundle, null) })
    store.loadActiveMaterial.mockResolvedValue({
      id: 'c1',
      fingerprint: 'AA',
      certPem: bundle,
      chainPem: null,
      keyPem: 'k',
    })

    await expect(applyActiveCertificate()).resolves.toBe('unchanged')
    expect(controller.reload).not.toHaveBeenCalled()
  })

  it('still does nothing when leaf, chain and minimum version all match', async () => {
    controller.state.mockReturnValue({ ...UP })

    await expect(applyActiveCertificate()).resolves.toBe('unchanged')
    expect(controller.reload).not.toHaveBeenCalled()
    expect(controller.stop).not.toHaveBeenCalled()
  })
})
