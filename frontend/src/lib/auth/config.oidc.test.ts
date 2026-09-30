import { describe, it, expect, vi, beforeEach } from 'vitest'

const { getOidcConfig } = vi.hoisted(() => ({ getOidcConfig: vi.fn() }))

vi.mock('@/lib/db/prisma', () => ({ prisma: {} }))
vi.mock('@/lib/auth/oidc', () => ({
  getOidcConfig,
  isOidcEnabled: async () => true,
  oidcSeedRoleId: vi.fn(),
  syncOidcRoleAssignment: vi.fn(),
}))

import { getAuthOptions } from './config'

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
  beforeEach(() => getOidcConfig.mockReset())

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
})
