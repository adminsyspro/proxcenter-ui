import { describe, expect, it, vi, beforeEach } from 'vitest'

import { Features, EDITION_FEATURES, OPTION_REGISTRY } from '@/lib/license/features'
import { _impl, type ServerLicense } from '@/lib/auth/requireEnterprise'
import { isApiAccessLicensed, _resetLicenseVerdictCache } from './licenseGate'

const LICENSED: ServerLicense = {
  enterprise: true,
  edition: 'enterprise',
  licensed: true,
  expired: false,
  features: [],
  options: ['api_access'],
}

const UNLICENSED: ServerLicense = {
  enterprise: true,
  edition: 'enterprise',
  licensed: true,
  expired: false,
  features: [],
  options: [],
}

beforeEach(() => {
  vi.restoreAllMocks()
  _resetLicenseVerdictCache()
})

describe('api_access feature registration', () => {
  it('declares the id, the option registry entry, and NEVER an edition feature', () => {
    expect(Features.API_ACCESS).toBe('api_access')
    expect(OPTION_REGISTRY['api_access'].name.length).toBeGreaterThan(0)
    expect(EDITION_FEATURES.enterprise).not.toContain('api_access')
    expect(EDITION_FEATURES.enterprise_plus).not.toContain('api_access')
  })
})

describe('isApiAccessLicensed (60s verdict cache, fail-closed)', () => {
  it('grants when the option is present on an Enterprise edition', async () => {
    vi.spyOn(_impl, 'getServerLicense').mockResolvedValue(LICENSED)
    expect(await isApiAccessLicensed()).toBe(true)
  })

  it('denies when the option is absent, and never grants features[] cosmetics', async () => {
    vi.spyOn(_impl, 'getServerLicense').mockResolvedValue({ ...UNLICENSED, features: ['api_access'] })
    expect(await isApiAccessLicensed()).toBe(false)
  })

  it('denies when the orchestrator is unreachable (community fallback, fail-closed)', async () => {
    vi.spyOn(_impl, 'getServerLicense').mockResolvedValue({
      enterprise: false, edition: 'community', licensed: false, expired: false, features: [], options: [],
    })
    expect(await isApiAccessLicensed()).toBe(false)
  })

  it('denies when the license is expired even with the option present', async () => {
    vi.spyOn(_impl, 'getServerLicense').mockResolvedValue({ ...LICENSED, expired: true })
    expect(await isApiAccessLicensed()).toBe(false)
  })

  it('denies the option on a non-Enterprise edition', async () => {
    vi.spyOn(_impl, 'getServerLicense').mockResolvedValue({
      ...LICENSED, enterprise: false, edition: 'community',
    })
    expect(await isApiAccessLicensed()).toBe(false)
  })

  it('caches the verdict for 60 seconds (one orchestrator round trip)', async () => {
    const spy = vi.spyOn(_impl, 'getServerLicense').mockResolvedValue(LICENSED)
    await isApiAccessLicensed()
    await isApiAccessLicensed()
    await isApiAccessLicensed()
    expect(spy).toHaveBeenCalledTimes(1)
  })

  it('re-fetches after the TTL and flips the verdict (revocation takes effect)', async () => {
    vi.useFakeTimers()
    try {
      const spy = vi.spyOn(_impl, 'getServerLicense').mockResolvedValue(LICENSED)
      expect(await isApiAccessLicensed()).toBe(true)
      spy.mockResolvedValue(UNLICENSED)
      vi.advanceTimersByTime(61_000)
      expect(await isApiAccessLicensed()).toBe(false)
      expect(spy).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })
})
