import { describe, it, expect, vi, beforeEach } from 'vitest'

const { getOidcConfig, isSessionTenantDisabledMock } = vi.hoisted(() => ({
  getOidcConfig: vi.fn(),
  isSessionTenantDisabledMock: vi.fn(),
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
