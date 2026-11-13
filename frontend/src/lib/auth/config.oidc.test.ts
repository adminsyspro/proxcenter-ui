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
// getAuthOptions lists the live connections (issue #1289); here they are the
// provider IdP returned by the getOidcConfig mock, when it is enabled.
vi.mock('./oidcConnections', async () => {
  const actual = await vi.importActual<typeof import('./oidcConnections')>('./oidcConnections')
  return {
    ...actual,
    listActiveOidcConnections: async () => {
      const c = await getOidcConfig()
      return c && c.enabled ? [{ id: 'default', tenantId: 'default', ...c }] : []
    },
  }
})
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
    requireVerifiedEmail: true,
    idpVerifiesEmail: false,
    ...overrides,
  }
}

// Ported to oidcMetadata.test.ts: discovery URL, manual endpoints and the
// per-connection agent are no longer provider fields (issue #1289).
async function oidcProvider() {
  const opts = await getAuthOptions(new Request('http://pxc.test/api/auth/signin/oidc', { method: 'POST' }))
  return (opts.providers as any[]).find(p => p.id === 'oidc')
}

describe('getAuthOptions OIDC provider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getOidcConfig.mockReset()
    isSessionTenantDisabledMock.mockReset().mockResolvedValue(false)
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
      details: { reason: 'oidc_sub_mismatch', provider: 'oidc', connection: 'default' },
    }))
  })

  it('refuses an unverified address for a super admin account', async () => {
    ;(prisma.user.findUnique as any).mockResolvedValue({ ...localAccount, oidcSub: null })
    ;(prisma.rbacUserRole.findFirst as any).mockResolvedValue({ id: 'grant-1' })

    expect(await signIn({})).toBe('/login?error=OidcLinkRefused')
    expect(prisma.user.update).not.toHaveBeenCalled()
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
      details: { reason: 'email_not_verified', provider: 'oidc', connection: 'default' },
    }))
  })

  it('refuses an unverified address for an ordinary account when a verified e-mail is required', async () => {
    ;(prisma.user.findUnique as any).mockResolvedValue({ ...localAccount, oidcSub: null })
    ;(prisma.rbacUserRole.findFirst as any).mockResolvedValue(null)

    expect(await signIn({ email_verified: false })).toBe('/login?error=OidcLinkRefused')
    expect(prisma.user.update).not.toHaveBeenCalled()
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
      action: 'login_failed',
      details: { reason: 'email_not_verified', provider: 'oidc', connection: 'default' },
    }))
  })

  it('links an unverified address to an ordinary account when only auditing, and audits it', async () => {
    getOidcConfig.mockResolvedValue(baseConfig({ requireVerifiedEmail: false }))
    ;(prisma.user.findUnique as any).mockResolvedValue({ ...localAccount, oidcSub: null })
    ;(prisma.rbacUserRole.findFirst as any).mockResolvedValue(null)

    await signIn({ email_verified: false })
    expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'u-local' },
      data: expect.objectContaining({ oidcSub: 'sub-new', authProvider: 'oidc' }),
    }))
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
      action: 'login',
      status: 'warning',
      userEmail: 'admin@example.test',
      details: { reason: 'email_not_verified', provider: 'oidc', linked: true, connection: 'default' },
    }))
  })

  it('links a verified address without any audit entry', async () => {
    ;(prisma.user.findUnique as any).mockResolvedValue({ ...localAccount, oidcSub: null })
    ;(prisma.rbacUserRole.findFirst as any).mockResolvedValue(null)

    await signIn({ email_verified: true })
    expect(prisma.user.update).toHaveBeenCalled()
    expect(auditMock).not.toHaveBeenCalled()
  })

  it('drops the local password of the account it converts', async () => {
    ;(prisma.user.findUnique as any).mockResolvedValue({ ...localAccount, oidcSub: null, password: 'h', localLoginAllowed: false })
    ;(prisma.rbacUserRole.findFirst as any).mockResolvedValue(null)

    await signIn({ email_verified: true })
    expect(prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: 'u-local' },
      data: expect.objectContaining({ authProvider: 'oidc', password: null }),
    }))
  })

  it('keeps the local password of an account with emergency access', async () => {
    ;(prisma.user.findUnique as any).mockResolvedValue({ ...localAccount, oidcSub: null, password: 'h', localLoginAllowed: true })

    await signIn({ email_verified: true })
    const { data } = (prisma.user.update as any).mock.calls[0][0]
    expect(data).not.toHaveProperty('password')
    expect(data.localLoginAllowed).toBe(true)
  })

  it('leaves an account found by its own subject alone', async () => {
    ;(prisma.user.findFirst as any).mockResolvedValue({ ...localAccount, oidcSub: 'sub-new' })

    await signIn({})
    expect(prisma.user.findUnique).not.toHaveBeenCalled()
    expect(prisma.user.update).toHaveBeenCalled()
    expect(auditMock).not.toHaveBeenCalled()
  })
})

