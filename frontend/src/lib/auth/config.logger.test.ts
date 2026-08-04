import { describe, it, expect, vi, afterEach } from 'vitest'

// Same import-time mocks as config.jwt.test.ts: config.ts pulls in prisma,
// oidc and next/headers at module load, none of which may touch a real DB
// or request scope in this test.
vi.mock('@/lib/db/prisma', () => ({ prisma: { user: { findUnique: vi.fn(async () => null) } } }))
vi.mock('@/lib/auth/oidc', () => ({ getOidcConfig: async () => null, isOidcEnabled: async () => false }))
vi.mock('next/headers', () => ({
  headers: async () => new Headers(),
}))

import { authOptions } from './config'

const errorLog = authOptions.logger?.error as (code: string, metadata: unknown) => void

describe('authOptions.logger.error', () => {
  const consoleInfoSpy = vi.spyOn(console, 'info').mockImplementation(() => {})
  const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

  afterEach(() => {
    consoleInfoSpy.mockClear()
    consoleErrorSpy.mockClear()
  })

  // Every exact message the `jwt` callback's read path throws in ./config.ts.
  const ourRefusalMessages = [
    'Session not valid: no sid on token',
    'Session not valid: missing',
    'Session not valid: revoked',
    'Session not valid: idle',
    'Session not valid: absolute',
    'Account disabled',
  ]

  it.each(ourRefusalMessages)('reports our own refusal "%s" as a quiet info line, no stack', message => {
    errorLog('JWT_SESSION_ERROR', new Error(message))

    expect(consoleErrorSpy).not.toHaveBeenCalled()
    expect(consoleInfoSpy).toHaveBeenCalledTimes(1)

    const loggedArgs = consoleInfoSpy.mock.calls[0]
    expect(loggedArgs.join(' ')).toContain(message)
    expect(loggedArgs.join(' ')).not.toContain('at Object.jwt') // no stack trace text
    expect(loggedArgs.some(arg => typeof arg === 'object' && arg !== null && 'stack' in arg)).toBe(false)
  })

  it('does NOT silence JWT_SESSION_ERROR wholesale: an unrelated message stays loud, with its stack', () => {
    const unrelated = new Error('JWT invalid')

    errorLog('JWT_SESSION_ERROR', unrelated)

    expect(consoleInfoSpy).not.toHaveBeenCalled()
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1)

    const [prefix, metadata] = consoleErrorSpy.mock.calls[0]
    expect(prefix).toContain('JWT_SESSION_ERROR')
    // Logged AS RECEIVED (no reformatting): the raw Error instance itself,
    // so its message and stack are exactly what console.error renders them
    // to be, not a rebuilt {message, stack, name} object.
    expect(metadata).toBe(unrelated)
    expect((metadata as Error).message).toBe('JWT invalid')
    expect((metadata as Error).stack).toContain('JWT invalid')
  })

  it('passes through a different error code untouched (loud, unmodified metadata)', () => {
    const err = new Error('some oauth failure')

    errorLog('OAUTH_CALLBACK_ERROR', err)

    expect(consoleInfoSpy).not.toHaveBeenCalled()
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1)
    const [prefix, metadata] = consoleErrorSpy.mock.calls[0]
    expect(prefix).toContain('OAUTH_CALLBACK_ERROR')
    expect(metadata).toBe(err)
  })

  it('a message that merely CONTAINS our refusal text as a substring is NOT matched (exact match only)', () => {
    const lookalike = new Error('wrapper: Session not valid: idle (retry #3)')

    errorLog('JWT_SESSION_ERROR', lookalike)

    // Not an exact match against our known set, so it must stay loud —
    // proving the check is not a loose substring test.
    expect(consoleInfoSpy).not.toHaveBeenCalled()
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1)
  })

  it('preserves every field of an ENVELOPE metadata object (OIDC provider errors must not lose context)', () => {
    // Several next-auth codes (OAUTH_CALLBACK_ERROR, OAUTH_CALLBACK_HANDLER_ERROR,
    // OAUTH_PARSE_PROFILE_ERROR, SIGNIN_OAUTH_ERROR, SIGNIN_EMAIL_ERROR) report
    // an envelope object, not a bare Error. A hand-rolled reformatter that only
    // special-cases `instanceof Error` would silently drop providerId here —
    // this is the regression test for exactly that mistake.
    const envelope = {
      error: new Error('boom'),
      providerId: 'keycloak',
      error_description: 'invalid_grant',
    }

    errorLog('OAUTH_CALLBACK_ERROR', envelope)

    expect(consoleInfoSpy).not.toHaveBeenCalled()
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1)

    const [, metadata] = consoleErrorSpy.mock.calls[0]
    // Logged as the exact same reference: nothing was reconstructed, so
    // providerId (and every other sibling key) cannot have been dropped.
    expect(metadata).toBe(envelope)
    expect((metadata as typeof envelope).providerId).toBe('keycloak')
    expect((metadata as typeof envelope).error_description).toBe('invalid_grant')
    expect((metadata as typeof envelope).error).toBe(envelope.error)
  })
})
