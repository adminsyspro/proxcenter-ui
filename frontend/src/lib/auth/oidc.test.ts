import { describe, it, expect } from 'vitest'

import { resolveOidcRole } from './oidc'
import type { OidcConfig } from './oidc'

function makeConfig(mapping: Record<string, string>, defaultRole = 'role_default'): OidcConfig {
  return {
    enabled: true,
    providerName: 'SSO',
    issuerUrl: 'https://idp.example.com',
    clientId: 'cid',
    clientSecret: null,
    scopes: 'openid profile email',
    authorizationUrl: null,
    tokenUrl: null,
    userinfoUrl: null,
    claimEmail: 'email',
    claimName: 'name',
    claimGroups: 'groups',
    autoProvision: true,
    defaultRole,
    groupRoleMapping: mapping,
    showLocalLogin: true,
    forceSsoRedirect: false,
  }
}

describe('resolveOidcRole', () => {
  it('falls back to defaultRole when groups is missing or empty', () => {
    const cfg = makeConfig({ admin: 'role_admin' })
    expect(resolveOidcRole(undefined, cfg)).toBe('role_default')
    expect(resolveOidcRole([], cfg)).toBe('role_default')
  })

  it('falls back to defaultRole when the mapping is empty', () => {
    const cfg = makeConfig({})
    expect(resolveOidcRole(['admin'], cfg)).toBe('role_default')
  })

  it('returns the role of the first group that matches', () => {
    const cfg = makeConfig({ admin: 'role_admin', ops: 'role_ops' })
    expect(resolveOidcRole(['admin'], cfg)).toBe('role_admin')
    expect(resolveOidcRole(['ops'], cfg)).toBe('role_ops')
  })

  it('trims whitespace on incoming group names before lookup', () => {
    const cfg = makeConfig({ admin: 'role_admin' })
    expect(resolveOidcRole([' admin '], cfg)).toBe('role_admin')
  })

  it('skips empty and whitespace-only entries', () => {
    const cfg = makeConfig({ admin: 'role_admin' })
    expect(resolveOidcRole(['', '   ', 'admin'], cfg)).toBe('role_admin')
  })

  it('falls back to defaultRole when no group matches', () => {
    const cfg = makeConfig({ admin: 'role_admin' })
    expect(resolveOidcRole(['unknown', 'other'], cfg)).toBe('role_default')
  })

  it('first match wins (mapping order, not lookup order)', () => {
    const cfg = makeConfig({ admin: 'role_admin', ops: 'role_ops' })
    // 'ops' comes first in the groups list, so its role wins.
    expect(resolveOidcRole(['ops', 'admin'], cfg)).toBe('role_ops')
  })
})
