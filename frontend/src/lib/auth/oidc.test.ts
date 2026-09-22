import { describe, it, expect } from 'vitest'

import { resolveOidcRole } from './oidc'
import type { OidcConfig } from './oidc'
import { normalizeGroupGrantMapping } from './groupMapping'

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
    groupGrants: normalizeGroupGrantMapping(mapping),
    groupMappingStrategy: 'first_match',
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

  // Issue #992: the mapping decides, not the claim. The form says "first match
  // wins" about rows the admin can see and reorder; before the fix the winner
  // was whichever group the IdP happened to list first.
  it('first match wins on the mapping order, not the claim order', () => {
    const cfg = makeConfig({ admin: 'role_admin', ops: 'role_ops' })
    expect(resolveOidcRole(['ops', 'admin'], cfg)).toBe('role_admin')
    expect(resolveOidcRole(['admin', 'ops'], cfg)).toBe('role_admin')
  })
})
