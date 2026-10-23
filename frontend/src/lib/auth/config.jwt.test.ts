import { describe, it, expect, vi, afterEach } from 'vitest'

const { loadJwtContextMock, createSessionMock, revokeSessionMock, touchSessionMock, auditMock } = vi.hoisted(() => ({
  loadJwtContextMock: vi.fn(),
  createSessionMock: vi.fn(),
  revokeSessionMock: vi.fn(),
  touchSessionMock: vi.fn(),
  auditMock: vi.fn(),
}))

vi.mock('@/lib/db/prisma', () => ({ prisma: { user: { findUnique: vi.fn(async () => null) } } }))
vi.mock('@/lib/auth/oidc', () => ({ getOidcConfig: async () => null, isOidcEnabled: async () => false }))
vi.mock('./jwtContext', () => ({ loadJwtContext: loadJwtContextMock, isSessionTenantDisabled: vi.fn() }))
vi.mock('./sessions', async (orig) => {
  const actual = await orig<typeof import('./sessions')>()
  return {
    ...actual,
    createSession: createSessionMock,
    revokeSession: revokeSessionMock,
    touchSession: touchSessionMock,
  }
})
vi.mock('@/lib/audit', () => ({ audit: auditMock }))
vi.mock('next/headers', () => ({
  // A forged first hop, then the address the bundled nginx (1 trusted proxy) appended.
  headers: async () => new Headers({ 'x-forwarded-for': '6.6.6.6, 10.0.0.9', 'user-agent': 'UA/1' }),
}))

import { authOptions } from './config'

const jwtCb = (authOptions.callbacks as any).jwt

afterEach(() => vi.clearAllMocks())

const liveSession = {
  id: 'sid1', userId: 'u1',
  createdAt: new Date(Date.now() - 3600_000),
  lastSeenAt: new Date(Date.now() - 1000),
  revokedAt: null, ipAddress: null, userAgent: null,
}

describe('sign-in path (user present) — MUST NEVER THROW', () => {
  it('guards against oversized console cookies by storing the OIDC id_token only on the session row', async () => {
    // Group claims can exceed the HTTP/1.1 WebSocket handshake header limit.
    const idToken = 'header.' + 'x'.repeat(8000) + '.signature'
    createSessionMock.mockResolvedValue('oidc-sid')
    loadJwtContextMock.mockResolvedValue({ tenantId: 'default', tenantEnabled: true, mustEnroll2fa: false })
    const token = await jwtCb({
      token: {},
      user: { id: 'u1', email: 'a@b', name: 'A', role: 'admin' },
      account: { provider: 'oidc', id_token: idToken },
    })

    expect(token.sid).toBe('oidc-sid')
    expect(token.authProvider).toBe('oidc')
    expect(token).not.toHaveProperty('idToken')
    expect(JSON.stringify(token)).not.toContain(idToken)
    expect(createSessionMock).toHaveBeenCalledExactlyOnceWith({
      userId: 'u1', ipAddress: '10.0.0.9', userAgent: 'UA/1', idToken,
    })
  })

  it('mints a sid and authAt, records the origin and passes a null idToken for credentials', async () => {
    createSessionMock.mockResolvedValue('new-sid')
    const token = await jwtCb({
      token: {},
      user: { id: 'u1', email: 'a@b', name: 'A', role: 'admin', authProvider: 'credentials' },
      account: { provider: 'credentials' },
    })

    expect(token.sid).toBe('new-sid')
    expect(typeof token.authAt).toBe('number')
    expect(createSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', ipAddress: '10.0.0.9', userAgent: 'UA/1', idToken: null }),
    )
  })

  it('still returns a usable token when the session insert FAILS (no 500 on login)', async () => {
    // callbacks.jwt is invoked at core/routes/callback.js:397-413 with no local
    // try/catch: throwing here is a 500 for every user signing in.
    createSessionMock.mockRejectedValue(new Error('db down'))
    const token = await jwtCb({
      token: {},
      user: { id: 'u1', email: 'a@b', name: 'A', role: 'admin', authProvider: 'credentials' },
      account: { provider: 'credentials' },
    })
    expect(token.id).toBe('u1')
    expect(token.sid).toBeUndefined()
  })

  it('never throws even when loadJwtContext fails on sign-in', async () => {
    createSessionMock.mockResolvedValue('new-sid')
    loadJwtContextMock.mockRejectedValue(new Error('db down'))
    await expect(
      jwtCb({
        token: {},
        user: { id: 'u1', email: 'a@b', name: 'A', role: 'v', authProvider: 'credentials' },
        account: { provider: 'oidc' },
      }),
    ).resolves.toBeTruthy()
  })
})

describe('read path (no user) — refuses by throwing', () => {
  it('passes a live session through and touches it', async () => {
    loadJwtContextMock.mockResolvedValue({
      enabled: true, tenantId: 'tenant-a', mustEnroll2fa: false, session: liveSession,
      tenantEnabled: true,
    })
    const token = await jwtCb({ token: { id: 'u1', sid: 'sid1', authAt: Date.now() } })
    expect(token.tenantId).toBe('tenant-a')
    expect(touchSessionMock).toHaveBeenCalledOnce()
  })

  it('throws when the session row is gone', async () => {
    loadJwtContextMock.mockResolvedValue({
      enabled: true, tenantId: 'default', mustEnroll2fa: false, session: null,
      tenantEnabled: true,
    })
    await expect(jwtCb({ token: { id: 'u1', sid: 'sid1' } })).rejects.toThrow(/session/i)
  })

  it('throws when the session was revoked', async () => {
    loadJwtContextMock.mockResolvedValue({
      enabled: true, tenantId: 'default', mustEnroll2fa: false,
      tenantEnabled: true,
      session: { ...liveSession, revokedAt: new Date() },
    })
    await expect(jwtCb({ token: { id: 'u1', sid: 'sid1' } })).rejects.toThrow(/session/i)
  })

  it('throws when the account has been disabled since sign-in', async () => {
    loadJwtContextMock.mockResolvedValue({
      enabled: false, tenantId: 'default', mustEnroll2fa: false, session: liveSession,
      tenantEnabled: true,
    })
    await expect(jwtCb({ token: { id: 'u1', sid: 'sid1' } })).rejects.toThrow(/disabled/i)
  })

  it('throws on a legacy token with no sid (forces the one-off reconnection)', async () => {
    await expect(jwtCb({ token: { id: 'u1' } })).rejects.toThrow(/session/i)
  })

  it('throws when every tenant membership is disabled', async () => {
    loadJwtContextMock.mockResolvedValue({
      enabled: true, tenantId: 'tenant-off', tenantEnabled: false,
      mustEnroll2fa: false, session: liveSession,
    })

    await expect(jwtCb({ token: { id: 'u1', sid: 'sid1' } })).rejects.toThrow(/^Tenant disabled$/)
    expect(touchSessionMock).not.toHaveBeenCalled()
  })

  it('FAILS OPEN when the database is unreachable', async () => {
    // A Postgres outage already makes the app unusable, so refusing adds no
    // security and only causes a reconnection storm when the DB returns.
    loadJwtContextMock.mockRejectedValue(new Error('ECONNREFUSED'))
    const token = await jwtCb({ token: { id: 'u1', sid: 'sid1', tenantId: 'kept' } })
    expect(token.tenantId).toBe('kept')
  })
})

describe('events.signOut', () => {
  const signOut = (authOptions.events as any).signOut

  it('revokes the server-side session before auditing the logout', async () => {
    const order: string[] = []
    revokeSessionMock.mockImplementation(async () => { order.push('revoke') })
    auditMock.mockImplementation(async () => { order.push('audit') })

    await signOut({ token: { sid: 'sid1', id: 'u1', email: 'a@b.test' } })

    expect(revokeSessionMock).toHaveBeenCalledExactlyOnceWith('sid1', 'u1')
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
      action: 'logout', userId: 'u1', userEmail: 'a@b.test', status: 'success',
    }))
    expect(order).toEqual(['revoke', 'audit'])
  })

  it('does not try to revoke a token without a sid but still audits logout', async () => {
    await signOut({ token: { id: 'u1', email: 'a@b.test' } })

    expect(revokeSessionMock).not.toHaveBeenCalled()
    expect(auditMock).toHaveBeenCalledOnce()
  })

  it('keeps sign-out best-effort when revocation fails and still audits logout', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    revokeSessionMock.mockRejectedValue(new Error('db down'))

    await expect(signOut({ token: { sid: 'sid1', id: 'u1', email: 'a@b.test' } })).resolves.toBeUndefined()
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'logout', userId: 'u1' }))
    expect(errorSpy).toHaveBeenCalledWith(
      '[auth-session] could not revoke the session at sign-out:',
      'db down',
    )
    errorSpy.mockRestore()
  })
})

describe('session config', () => {
  afterEach(() => {
    delete process.env.SESSION_ABSOLUTE_TIMEOUT
  })

  it('caps maxAge at the absolute-timeout default (env unset) and drops the inert updateAge', () => {
    expect(authOptions.session?.maxAge).toBe(7 * 86400)
    expect((authOptions.session as any)?.updateAge).toBeUndefined()
  })

  it('derives maxAge from SESSION_ABSOLUTE_TIMEOUT instead of hardcoding it', async () => {
    // The point of this test: a hardcoded 7*86400 would pass the test above
    // but NOT this one. Module-load evaluation means we need a fresh import
    // with the env var already set.
    process.env.SESSION_ABSOLUTE_TIMEOUT = String(30 * 86400)
    vi.resetModules()
    const { authOptions: reloaded } = await import('./config')
    expect(reloaded.session?.maxAge).toBe(30 * 86400)
  })
})
