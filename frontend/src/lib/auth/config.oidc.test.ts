import { describe, it, expect, vi, beforeEach } from 'vitest'

const { getOidcConfig, isSessionTenantDisabledMock, auditMock } = vi.hoisted(() => ({
  getOidcConfig: vi.fn(),
  isSessionTenantDisabledMock: vi.fn(),
  auditMock: vi.fn(),
}))

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    user: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
    userTenant: { findFirst: vi.fn(), upsert: vi.fn() },
    rbacUserRole: { findFirst: vi.fn() },
  },
}))
vi.mock('@/lib/auth/oidc', () => ({
  getOidcConfig,
  isOidcEnabled: async () => true,
  oidcSeedRoleId: vi.fn(),
  syncOidcRoleAssignment: vi.fn(),
}))
vi.mock('./jwtContext', () => ({
  loadJwtContext: vi.fn(),
  isSessionTenantDisabled: isSessionTenantDisabledMock,
}))
vi.mock('@/lib/tenant', () => ({ addUserToTenant: vi.fn(), removeUserFromTenant: vi.fn() }))
vi.mock('@/lib/audit', () => ({ audit: auditMock }))

import { prisma } from '@/lib/db/prisma'
import { authOptions, getAuthOptions } from './config'

function baseConfig(overrides: Record<string, unknown> = {}) {
  return {
    enabled: true,
    providerName: 'Keycloak',
    issuerUrl: 'https://idp.example.com/realms/x//',
    clientId: 'proxcenter',
    clientSecret: 's3cret',
    scopes: 'openid profile email',
    authorizationUrl: '',
    tokenUrl: '',
    userinfoUrl: '',
    claimEmail: 'email',
    claimName: 'name',
    ...overrides,
  }
}

async function oidcProvider() {
  const opts = await getAuthOptions()
  return (opts.providers as any[]).find(p => p.id === 'oidc')
}

describe('getAuthOptions OIDC provider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getOidcConfig.mockReset()
    isSessionTenantDisabledMock.mockReset().mockResolvedValue(false)
  })

  it('trims every trailing slash of the issuer before building the discovery URL', async () => {
    getOidcConfig.mockResolvedValue(baseConfig())
    const p = await oidcProvider()
    expect(p.wellKnown).toBe('https://idp.example.com/realms/x/.well-known/openid-configuration')
    expect(p.issuer).toBeUndefined()
    expect(p.name).toBe('Keycloak')
  })

  it('leaves an issuer without trailing slash untouched', async () => {
    getOidcConfig.mockResolvedValue(baseConfig({ issuerUrl: 'https://idp.example.com/realms/x' }))
    const p = await oidcProvider()
    expect(p.wellKnown).toBe('https://idp.example.com/realms/x/.well-known/openid-configuration')
  })

  it('skips discovery and passes the raw issuer when manual endpoints are set', async () => {
    getOidcConfig.mockResolvedValue(baseConfig({ authorizationUrl: 'https://idp.example.com/auth' }))
    const p = await oidcProvider()
    expect(p.wellKnown).toBeUndefined()
    expect(p.issuer).toBe('https://idp.example.com/realms/x//')
    expect(p.authorization.url).toBe('https://idp.example.com/auth')
  })

  it('always hands openid-client an agent, false when no proxy is set (roadmap#78)', async () => {
    vi.stubEnv('HTTPS_PROXY', '')
    vi.stubEnv('HTTP_PROXY', '')
    getOidcConfig.mockResolvedValue(baseConfig())
    const p = await oidcProvider()
    // false, not undefined: openid-client keeps the options in a module global
    // that NextAuth only merges into, so a previous proxy agent would survive.
    expect(p.httpOptions).toEqual({ agent: false, timeout: 10000 })
    vi.unstubAllEnvs()
  })

  it('routes discovery, token and keys through the saved proxy (roadmap#78)', async () => {
    const https = await import('node:https')
    getOidcConfig.mockResolvedValue(baseConfig({ proxyUrl: 'http://proxy.corp:3128', proxyUsername: 'svc', proxyPassword: 'pw' }))
    const p = await oidcProvider()
    expect(p.httpOptions.agent).toBeInstanceOf(https.Agent)
    expect(p.httpOptions.timeout).toBe(10000)
  })

  it('adds no OIDC provider when OIDC is disabled', async () => {
    getOidcConfig.mockResolvedValue(baseConfig({ enabled: false }))
    expect(await oidcProvider()).toBeUndefined()
  })

  it('refuses OIDC sign-in when every tenant membership is disabled', async () => {
    getOidcConfig.mockResolvedValue(baseConfig())
    ;(prisma.user.findFirst as any).mockResolvedValue({
      id: 'u-oidc', email: 'oidc@example.test', name: 'OIDC', role: 'viewer', enabled: true, oidcSub: 'sub-1',
    })
    ;(prisma.userTenant.findFirst as any).mockResolvedValue({ userId: 'u-oidc' })
    isSessionTenantDisabledMock.mockResolvedValue(true)

    const accepted = await (authOptions.callbacks as any).signIn({
      user: { id: 'sub-1' },
      account: { provider: 'oidc' },
      profile: { sub: 'sub-1', email: 'oidc@example.test', name: 'OIDC' },
    })

    expect(accepted).toBe(false)
    expect(isSessionTenantDisabledMock).toHaveBeenCalledExactlyOnceWith('u-oidc')
  })
})

describe('OIDC sign-in binding a local account found by e-mail (H2)', () => {
  const localAccount = { id: 'u-local', email: 'admin@example.test', name: 'Admin', role: 'admin', enabled: true }

  function signIn(profile: Record<string, unknown>) {
    return (authOptions.callbacks as any).signIn({
      user: { id: 'sub-new' },
      account: { provider: 'oidc' },
      profile: { sub: 'sub-new', email: 'admin@example.test', name: 'Admin', ...profile },
    })
  }

  beforeEach(() => {
    vi.clearAllMocks()
    getOidcConfig.mockReset().mockResolvedValue(baseConfig())
    isSessionTenantDisabledMock.mockReset().mockResolvedValue(false)
    ;(prisma.user.findFirst as any).mockResolvedValue(null)
    ;(prisma.userTenant.findFirst as any).mockResolvedValue({ userId: 'u-local' })
  })

  it('never re-binds an account already tied to another subject', async () => {
    ;(prisma.user.findUnique as any).mockResolvedValue({ ...localAccount, oidcSub: 'sub-old' })

    expect(await signIn({ email_verified: true })).toBe('/login?error=OidcLinkRefused')
    expect(prisma.user.update).not.toHaveBeenCalled()
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
      action: 'login_failed',
      userEmail: 'admin@example.test',
      details: { reason: 'oidc_sub_mismatch', provider: 'oidc' },
    }))
  })

  it('refuses an unverified address for a super admin account', async () => {
    ;(prisma.user.findUnique as any).mockResolvedValue({ ...localAccount, oidcSub: null })
    ;(prisma.rbacUserRole.findFirst as any).mockResolvedValue({ id: 'grant-1' })

    expect(await signIn({})).toBe('/login?error=OidcLinkRefused')
    expect(prisma.user.update).not.toHaveBeenCalled()
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
      details: { reason: 'email_not_verified', provider: 'oidc' },
    }))
  })

  it('still links an unverified address to an ordinary account', async () => {
    ;(prisma.user.findUnique as any).mockResolvedValue({ ...localAccount, oidcSub: null })
    ;(prisma.rbacUserRole.findFirst as any).mockResolvedValue(null)

    await signIn({ email_verified: false })
    expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'u-local' },
      data: expect.objectContaining({ oidcSub: 'sub-new', authProvider: 'oidc' }),
    }))
    expect(auditMock).not.toHaveBeenCalled()
  })

  it('leaves an account found by its own subject alone', async () => {
    ;(prisma.user.findFirst as any).mockResolvedValue({ ...localAccount, oidcSub: 'sub-new' })

    await signIn({})
    expect(prisma.user.findUnique).not.toHaveBeenCalled()
    expect(prisma.user.update).toHaveBeenCalled()
    expect(auditMock).not.toHaveBeenCalled()
  })
})
