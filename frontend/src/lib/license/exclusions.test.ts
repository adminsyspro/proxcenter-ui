/**
 * The license exclusion lookup behind the pveFetch write guard (roadmap#58).
 *
 * A write to an excluded connection is refused before any request, so the
 * lookup runs on every write: it is cached for a short while, answers false
 * for an unknown connection, and never turns a database hiccup into a
 * licensing refusal.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const findUnique = vi.fn()

vi.mock('@/lib/db/prisma', () => ({ prisma: { connection: { findUnique } } }))

const cookieLocale = vi.fn<() => string | undefined>()

vi.mock('next/headers', () => ({
  cookies: async () => {
    const value = cookieLocale()

    if (value === 'throw') throw new Error('cookies() was called outside a request scope')

    return { get: (name: string) => (name === 'NEXT_LOCALE' && value ? { value } : undefined) }
  },
}))

import { invalidateLicenseExclusionCache, isConnectionLicenseExcluded, licenseExcludedError, PveLicenseExcludedError } from './exclusions'

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(Date.parse('2026-10-15T12:00:00Z'))
  findUnique.mockReset()
  invalidateLicenseExclusionCache()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('isConnectionLicenseExcluded', () => {
  it('reads the flag of the connection, selecting only that column', async () => {
    findUnique.mockResolvedValue({ licenseExcluded: true })

    await expect(isConnectionLicenseExcluded('c-1')).resolves.toBe(true)
    expect(findUnique).toHaveBeenCalledWith({ where: { id: 'c-1' }, select: { licenseExcluded: true } })
  })

  it('answers false for a connection that is not excluded, or unknown', async () => {
    findUnique.mockResolvedValueOnce({ licenseExcluded: false }).mockResolvedValueOnce(null)

    await expect(isConnectionLicenseExcluded('c-1')).resolves.toBe(false)
    await expect(isConnectionLicenseExcluded('c-2')).resolves.toBe(false)
  })

  it('caches the answer for 30 seconds, per connection', async () => {
    findUnique.mockResolvedValue({ licenseExcluded: true })

    await isConnectionLicenseExcluded('c-1')
    await isConnectionLicenseExcluded('c-1')
    expect(findUnique).toHaveBeenCalledTimes(1)

    await isConnectionLicenseExcluded('c-2')
    expect(findUnique).toHaveBeenCalledTimes(2)

    vi.advanceTimersByTime(29_000)
    await isConnectionLicenseExcluded('c-1')
    expect(findUnique).toHaveBeenCalledTimes(2)

    vi.advanceTimersByTime(2_000)
    await isConnectionLicenseExcluded('c-1')
    expect(findUnique).toHaveBeenCalledTimes(3)
  })

  it('forgets one connection, or all of them, on invalidation', async () => {
    findUnique.mockResolvedValue({ licenseExcluded: false })

    await isConnectionLicenseExcluded('c-1')
    await isConnectionLicenseExcluded('c-2')
    invalidateLicenseExclusionCache('c-1')
    await isConnectionLicenseExcluded('c-1')
    await isConnectionLicenseExcluded('c-2')
    expect(findUnique).toHaveBeenCalledTimes(3)

    invalidateLicenseExclusionCache()
    await isConnectionLicenseExcluded('c-2')
    expect(findUnique).toHaveBeenCalledTimes(4)
  })

  it('never refuses a write because the database failed to answer', async () => {
    // Deliberately fail-open: nothing downstream guards a frontend write, so
    // a database hiccup leaves writes allowed for the TTL rather than reading
    // as a licensing decision, and is not retried on every write.
    findUnique.mockRejectedValue(new Error('ECONNREFUSED 127.0.0.1:5432'))

    await expect(isConnectionLicenseExcluded('c-1')).resolves.toBe(false)
    await expect(isConnectionLicenseExcluded('c-1')).resolves.toBe(false)
    expect(findUnique).toHaveBeenCalledTimes(1)
    expect(console.warn).toHaveBeenCalledTimes(1)
  })

  it('answers false without a lookup when no connection id is given', async () => {
    await expect(isConnectionLicenseExcluded('')).resolves.toBe(false)
    expect(findUnique).not.toHaveBeenCalled()
  })
})

describe('PveLicenseExcludedError', () => {
  it('carries the 403 status and the code the routes answer with', () => {
    const err = new PveLicenseExcludedError('c-1')

    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('PveLicenseExcludedError')
    expect(err.statusCode).toBe(403)
    expect(err.code).toBe('CONNECTION_LICENSE_EXCLUDED')
    expect(err.connectionId).toBe('c-1')
    expect(err.message).toBe('This cluster is outside the license: ProxCenter refuses any change on it.')
    expect(err.message).not.toMatch(/^PVE \d{3}/)
  })
})

describe('licenseExcludedError', () => {
  it('speaks the language of the request, since routes answer with its message', async () => {
    cookieLocale.mockReturnValue('fr')

    const e = await licenseExcludedError('c-1')

    expect(e).toBeInstanceOf(PveLicenseExcludedError)
    expect(e.connectionId).toBe('c-1')
    expect(e.code).toBe('CONNECTION_LICENSE_EXCLUDED')
    expect(e.message).toBe('Ce cluster est hors licence : ProxCenter refuse toute modification dessus.')
  })

  it('falls back to English without a locale cookie, with an unknown one, or outside a request', async () => {
    for (const value of [undefined, 'xx', 'throw']) {
      cookieLocale.mockReturnValue(value)

      const e = await licenseExcludedError('c-1')

      expect(e.message).toBe('This cluster is outside the license: ProxCenter refuses any change on it.')
    }
  })
})
