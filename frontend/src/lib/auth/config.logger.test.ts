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

    const [, , message, metadata] = consoleErrorSpy.mock.calls[0]
    expect(message).toBe('JWT invalid')
    expect(metadata).toMatchObject({ message: 'JWT invalid', name: 'Error' })
    expect((metadata as { stack?: string }).stack).toContain('JWT invalid')
  })

  it('passes through a different error code untouched (loud, default shape)', () => {
    const err = new Error('some oauth failure')

    errorLog('OAUTH_CALLBACK_ERROR', err)

    expect(consoleInfoSpy).not.toHaveBeenCalled()
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1)
    const [prefix, , message] = consoleErrorSpy.mock.calls[0]
    expect(prefix).toContain('OAUTH_CALLBACK_ERROR')
    expect(message).toBe('some oauth failure')
  })

  it('a message that merely CONTAINS our refusal text as a substring is NOT matched (exact match only)', () => {
    const lookalike = new Error('wrapper: Session not valid: idle (retry #3)')

    errorLog('JWT_SESSION_ERROR', lookalike)

    // Not an exact match against our known set, so it must stay loud —
    // proving the check is not a loose substring test.
    expect(consoleInfoSpy).not.toHaveBeenCalled()
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1)
  })
})
