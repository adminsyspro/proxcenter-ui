import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// vi.mock is hoisted above this file's top-level `const` bindings, so the
// mock functions themselves must come from vi.hoisted (same convention as
// src/lib/vdc/context.test.ts and src/lib/tls/store.test.ts) or the factory
// below reads `getSettingMock`/`setSettingMock` while they are still in the
// TDZ.
const { getSettingMock, setSettingMock } = vi.hoisted(() => ({
  getSettingMock: vi.fn(),
  setSettingMock: vi.fn(),
}))

vi.mock('@/lib/db/settings', () => ({ getSetting: getSettingMock, setSetting: setSettingMock }))

import { DEFAULT_TLS_SETTINGS, TLS_SETTINGS_KEY, type TlsSettings } from '@/lib/tls/schema'
import { loadTlsSettings, saveTlsSettings } from '@/lib/tls/settings'

// Mirrors the private PROVIDER_TENANT_ID constant in settings.ts — not
// exported, so hardcoded here the same way the module hardcodes it.
const PROVIDER_TENANT_ID = 'default'

let savedTlsEnabled: string | undefined

beforeEach(() => {
  vi.clearAllMocks()
  savedTlsEnabled = process.env.TLS_ENABLED
  delete process.env.TLS_ENABLED
  getSettingMock.mockResolvedValue(null)
})

afterEach(() => {
  // Never let one case's TLS_ENABLED leak into the next.
  if (savedTlsEnabled === undefined) delete process.env.TLS_ENABLED
  else process.env.TLS_ENABLED = savedTlsEnabled
})

describe('loadTlsSettings', () => {
  it('seeds enabled=false from an unset TLS_ENABLED when no row exists', async () => {
    await expect(loadTlsSettings()).resolves.toEqual(DEFAULT_TLS_SETTINGS)
    expect(getSettingMock).toHaveBeenCalledWith(TLS_SETTINGS_KEY, PROVIDER_TENANT_ID)
  })

  it('seeds enabled=true from TLS_ENABLED=true when no row exists', async () => {
    process.env.TLS_ENABLED = 'true'

    await expect(loadTlsSettings()).resolves.toEqual({ ...DEFAULT_TLS_SETTINGS, enabled: true })
  })

  it('writes the seed down, so TLS_ENABLED really is read once and not once per boot', async () => {
    process.env.TLS_ENABLED = 'true'

    await loadTlsSettings()

    expect(setSettingMock).toHaveBeenCalledWith(TLS_SETTINGS_KEY, PROVIDER_TENANT_ID, {
      ...DEFAULT_TLS_SETTINGS,
      enabled: true,
    })
  })

  it('does not write a seed when a row already exists', async () => {
    getSettingMock.mockResolvedValue({ ...DEFAULT_TLS_SETTINGS })

    await loadTlsSettings()

    expect(setSettingMock).not.toHaveBeenCalled()
  })

  it('still returns the seeded settings when persisting them fails: TLS must never take the boot down', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})

    process.env.TLS_ENABLED = 'true'
    setSettingMock.mockRejectedValueOnce(new Error('database is on fire'))

    await expect(loadTlsSettings()).resolves.toEqual({ ...DEFAULT_TLS_SETTINGS, enabled: true })
    expect(consoleError).toHaveBeenCalled()
    consoleError.mockRestore()
  })

  it('REGRESSION: once a tls row exists, TLS_ENABLED is structurally unreachable — the stored value wins, disabled included', async () => {
    // An operator who turned HTTPS off in the UI must not find it back on
    // after the next container restart just because the installer's
    // TLS_ENABLED=true is still sitting in the environment.
    process.env.TLS_ENABLED = 'true'
    const stored: TlsSettings = { ...DEFAULT_TLS_SETTINGS, enabled: false }

    getSettingMock.mockResolvedValue(stored)

    await expect(loadTlsSettings()).resolves.toEqual(stored)
  })

  it('falls back to the defaults, without throwing, when the stored row is missing a required field', async () => {
    const { enabled: _enabled, ...withoutEnabled } = DEFAULT_TLS_SETTINGS

    getSettingMock.mockResolvedValue(withoutEnabled)

    await expect(loadTlsSettings()).resolves.toEqual(DEFAULT_TLS_SETTINGS)
  })

  it('falls back to the defaults, without throwing, when the stored row has an invalid minVersion', async () => {
    getSettingMock.mockResolvedValue({ ...DEFAULT_TLS_SETTINGS, minVersion: 'TLSv1.0' })

    await expect(loadTlsSettings()).resolves.toEqual(DEFAULT_TLS_SETTINGS)
  })

  it('keeps the rest of the row when the stored DNS provider left the catalog', async () => {
    const stored = {
      ...DEFAULT_TLS_SETTINGS,
      enabled: true,
      source: 'acme',
      acme: { ...DEFAULT_TLS_SETTINGS.acme, challenge: 'dns-01', dns: { provider: 'gone', credentials: { apiToken: 'x' }, validationDelaySeconds: 5 } },
    }

    getSettingMock.mockResolvedValue(stored)

    await expect(loadTlsSettings()).resolves.toEqual({
      ...stored,
      acme: { ...stored.acme, dns: { provider: null, credentials: {}, validationDelaySeconds: 5 } },
    })
  })

  it('returns a stored row verbatim when it validates', async () => {
    const stored: TlsSettings = {
      ...DEFAULT_TLS_SETTINGS,
      enabled: true,
      redirectHttp: true,
      minVersion: 'TLSv1.3',
      source: 'uploaded',
    }

    getSettingMock.mockResolvedValue(stored)

    await expect(loadTlsSettings()).resolves.toEqual(stored)
  })
})

describe('saveTlsSettings', () => {
  it('parses the payload through the schema and persists it under the tls key for the provider tenant', async () => {
    const next: TlsSettings = { ...DEFAULT_TLS_SETTINGS, enabled: true }

    await expect(saveTlsSettings(next)).resolves.toEqual(next)
    expect(setSettingMock).toHaveBeenCalledWith(TLS_SETTINGS_KEY, PROVIDER_TENANT_ID, next)
  })

  it('rejects a payload the schema refuses, and never calls setSetting', async () => {
    const invalid = { ...DEFAULT_TLS_SETTINGS, minVersion: 'TLSv1.0' } as unknown as TlsSettings

    await expect(saveTlsSettings(invalid)).rejects.toThrow()
    expect(setSettingMock).not.toHaveBeenCalled()
  })
})
