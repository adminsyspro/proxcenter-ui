import { describe, it, expect } from 'vitest'

import { resolveLdapRole } from './ldap'
import type { LdapConfig } from './ldap'

function makeConfig(mapping: Record<string, string>): LdapConfig {
  return {
    enabled: true,
    url: 'ldap://example.com',
    bindDn: '',
    bindPassword: '',
    baseDn: 'dc=example,dc=com',
    userFilter: '(uid={{username}})',
    emailAttribute: 'mail',
    nameAttribute: 'cn',
    tlsInsecure: false,
    groupAttribute: 'memberOf',
    groupRoleMapping: mapping,
    defaultRole: 'role_viewer',
    requireGroup: false,
    allowedGroups: [],
  }
}

describe('resolveLdapRole', () => {
  it('returns null when groups list is missing or empty', () => {
    const cfg = makeConfig({ admin: 'role_admin' })
    expect(resolveLdapRole([], cfg)).toBeNull()
    expect(resolveLdapRole(undefined as any, cfg)).toBeNull()
  })

  it('returns null when the mapping is empty', () => {
    const cfg = makeConfig({})
    expect(resolveLdapRole(['admin'], cfg)).toBeNull()
  })

  it('matches a plain group name from the directory', () => {
    const cfg = makeConfig({ admin: 'role_admin' })
    expect(resolveLdapRole(['admin'], cfg)).toBe('role_admin')
  })

  it('falls back to extracting the CN from a DN-style group', () => {
    const cfg = makeConfig({ admin: 'role_admin' })
    expect(resolveLdapRole(['CN=admin,OU=Groups,DC=example,DC=com'], cfg)).toBe('role_admin')
  })

  it('trims whitespace on incoming group names before lookup', () => {
    const cfg = makeConfig({ admin: 'role_admin' })
    expect(resolveLdapRole([' admin '], cfg)).toBe('role_admin')
  })

  it('trims the extracted CN before comparing', () => {
    const cfg = makeConfig({ admin: 'role_admin' })
    expect(resolveLdapRole(['CN= admin ,OU=Groups'], cfg)).toBe('role_admin')
  })

  it('skips empty entries in the groups list', () => {
    const cfg = makeConfig({ admin: 'role_admin' })
    expect(resolveLdapRole(['', '   ', 'admin'], cfg)).toBe('role_admin')
  })

  it('returns null when no group matches so manual roles stay intact', () => {
    const cfg = makeConfig({ admin: 'role_admin' })
    expect(resolveLdapRole(['unknown'], cfg)).toBeNull()
  })
})
