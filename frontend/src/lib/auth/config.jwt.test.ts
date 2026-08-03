import { describe, it, expect, vi, afterEach } from 'vitest'

const { loadJwtContextMock, createSessionMock, touchSessionMock } = vi.hoisted(() => ({
  loadJwtContextMock: vi.fn(),
  createSessionMock: vi.fn(),
  touchSessionMock: vi.fn(),
}))

vi.mock('@/lib/db/prisma', () => ({ prisma: { user: { findUnique: vi.fn(async () => null) } } }))
vi.mock('@/lib/auth/oidc', () => ({ getOidcConfig: async () => null, isOidcEnabled: async () => false }))
vi.mock('./jwtContext', () => ({ loadJwtContext: loadJwtContextMock }))
vi.mock('./sessions', async (orig) => {
  const actual = await orig<typeof import('./sessions')>()
  return { ...actual, createSession: createSessionMock, touchSession: touchSessionMock }
})
vi.mock('next/headers', () => ({
  headers: async () => new Headers({ 'x-forwarded-for': '10.0.0.9, 172.16.0.1', 'user-agent': 'UA/1' }),
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
  it('mints a sid and authAt and records the request origin', async () => {
    createSessionMock.mockResolvedValue('new-sid')
    const token = await jwtCb({
      token: {},
      user: { id: 'u1', email: 'a@b', name: 'A', role: 'admin', authProvider: 'credentials' },
      account: { provider: 'credentials' },
    })

    expect(token.sid).toBe('new-sid')
    expect(typeof token.authAt).toBe('number')
    expect(createSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', ipAddress: '10.0.0.9', userAgent: 'UA/1' }),
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
    })
    const token = await jwtCb({ token: { id: 'u1', sid: 'sid1', authAt: Date.now() } })
    expect(token.tenantId).toBe('tenant-a')
    expect(touchSessionMock).toHaveBeenCalledOnce()
  })

  it('throws when the session row is gone', async () => {
    loadJwtContextMock.mockResolvedValue({
      enabled: true, tenantId: 'default', mustEnroll2fa: false, session: null,
    })
    await expect(jwtCb({ token: { id: 'u1', sid: 'sid1' } })).rejects.toThrow(/session/i)
  })

  it('throws when the session was revoked', async () => {
    loadJwtContextMock.mockResolvedValue({
      enabled: true, tenantId: 'default', mustEnroll2fa: false,
      session: { ...liveSession, revokedAt: new Date() },
    })
    await expect(jwtCb({ token: { id: 'u1', sid: 'sid1' } })).rejects.toThrow(/session/i)
  })

  it('throws when the account has been disabled since sign-in', async () => {
    loadJwtContextMock.mockResolvedValue({
      enabled: false, tenantId: 'default', mustEnroll2fa: false, session: liveSession,
    })
    await expect(jwtCb({ token: { id: 'u1', sid: 'sid1' } })).rejects.toThrow(/disabled/i)
  })

  it('throws on a legacy token with no sid (forces the one-off reconnection)', async () => {
    await expect(jwtCb({ token: { id: 'u1' } })).rejects.toThrow(/session/i)
  })

  it('FAILS OPEN when the database is unreachable', async () => {
    // A Postgres outage already makes the app unusable, so refusing adds no
    // security and only causes a reconnection storm when the DB returns.
    loadJwtContextMock.mockRejectedValue(new Error('ECONNREFUSED'))
    const token = await jwtCb({ token: { id: 'u1', sid: 'sid1', tenantId: 'kept' } })
    expect(token.tenantId).toBe('kept')
  })
})

describe('session config', () => {
  it('caps maxAge at the absolute timeout and drops the inert updateAge', () => {
    expect(authOptions.session?.maxAge).toBe(7 * 86400)
    expect((authOptions.session as any)?.updateAge).toBeUndefined()
  })
})
