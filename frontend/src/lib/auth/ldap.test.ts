import { describe, it, expect, vi, beforeEach } from 'vitest'

import { resolveLdapRole } from './ldap'
import type { LdapConfig } from './ldap'

// vi.hoisted : le module est importé statiquement en tête de fichier, donc la
// fabrique de mock s'exécute avant une simple const.
const { findUniqueMock } = vi.hoisted(() => ({ findUniqueMock: vi.fn() }))

vi.mock('@/lib/db/prisma', () => ({
  prisma: { ldapConfig: { findUnique: findUniqueMock } },
}))

vi.mock('@/lib/crypto/secret', () => ({ decryptSecret: (v: string) => v.replace(/^enc:/, '') }))

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
    caCert: null,
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

/**
 * The CA certificate of issue #981 is read from the row and forwarded to the
 * orchestrator: it is the stored value, not the form, that has to reach the
 * bind, otherwise a sign-in fails on a directory the test button accepted.
 */
const ROW = {
  enabled: true,
  url: 'ldaps://dc.example.org:636',
  bindDn: 'cn=admin,dc=example,dc=org',
  bindPasswordEnc: 'enc:secret',
  baseDn: 'dc=example,dc=org',
  userFilter: '(uid={{username}})',
  emailAttribute: 'mail',
  nameAttribute: 'cn',
  tlsInsecure: false,
  caCert: '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----',
  groupAttribute: 'memberOf',
  groupRoleMapping: {},
  defaultRole: 'role_viewer',
  requireGroup: false,
  allowedGroups: [],
}

describe('getLdapConfig', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('carries the stored CA certificate', async () => {
    findUniqueMock.mockResolvedValue(ROW)
    const { getLdapConfig } = await import('./ldap')
    const cfg = await getLdapConfig()
    expect(cfg?.caCert).toBe(ROW.caCert)
  })

  it('reports no certificate as null rather than an empty string', async () => {
    findUniqueMock.mockResolvedValue({ ...ROW, caCert: null })
    const { getLdapConfig } = await import('./ldap')
    const cfg = await getLdapConfig()
    expect(cfg?.caCert).toBeNull()
  })
})

describe('authenticateLdap', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('sends the stored CA certificate with the bind request', async () => {
    findUniqueMock.mockResolvedValue(ROW)
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, user: { dn: 'uid=jdoe', email: 'jdoe@example.org', name: 'John Doe' } }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const { authenticateLdap } = await import('./ldap')
    const user = await authenticateLdap('jdoe', 'secret')

    expect(user?.email).toBe('jdoe@example.org')
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(sent.config.ca_cert).toBe(ROW.caCert)
  })

  it('sends an empty certificate when none is stored, leaving the system store in place', async () => {
    findUniqueMock.mockResolvedValue({ ...ROW, caCert: null })
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, user: { dn: 'uid=jdoe', email: 'jdoe@example.org', name: 'John Doe' } }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const { authenticateLdap } = await import('./ldap')
    await authenticateLdap('jdoe', 'secret')

    expect(JSON.parse(fetchMock.mock.calls[0][1].body).config.ca_cert).toBe('')
  })
})
