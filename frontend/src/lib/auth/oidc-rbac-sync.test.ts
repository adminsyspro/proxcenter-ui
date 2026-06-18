import { describe, it, expect, vi, beforeEach } from 'vitest'

import { syncOidcRoleAssignment, oidcRoleId } from './oidc'
import type { OidcConfig } from './oidc'

function makeConfig(mapping: Record<string, string>, defaultRole = 'role_viewer'): OidcConfig {
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

function makeDb(overrides: Partial<Record<string, any>> = {}) {
  return {
    rbacRole: { findUnique: vi.fn().mockResolvedValue({ id: 'role_db' }) },
    rbacUserRole: {
      findFirst: vi.fn().mockResolvedValue(null),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      create: vi.fn().mockResolvedValue({}),
    },
    $transaction: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as any
}

const baseParams = (extra: any = {}) => ({
  userId: 'u1',
  groups: ['db'] as string[] | undefined,
  config: makeConfig({ db: 'role_db' }),
  now: new Date('2026-06-18T00:00:00Z'),
  newId: () => 'oidc_fixed',
  ...extra,
})

describe('oidcRoleId', () => {
  it('normalises a bare mapping value to a role_ id', () => {
    expect(oidcRoleId(['ops'], makeConfig({ ops: 'ops' }))).toBe('role_ops')
  })

  it('passes through an already-prefixed mapping value', () => {
    expect(oidcRoleId(['ops'], makeConfig({ ops: 'role_ops' }))).toBe('role_ops')
  })

  it('normalises the default role when no group matches', () => {
    expect(oidcRoleId(['nope'], makeConfig({ ops: 'role_ops' }, 'viewer'))).toBe('role_viewer')
  })
})

describe('syncOidcRoleAssignment (issue #383)', () => {
  let db: any
  beforeEach(() => {
    db = makeDb()
  })

  it('replaces the OIDC-managed row with the mapped role as an inherit assignment', async () => {
    await syncOidcRoleAssignment(db, baseParams())

    // Only oidc_-owned rows are removed, never manual or ldap_ assignments.
    expect(db.rbacUserRole.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'u1', tenantId: 'default', id: { startsWith: 'oidc_' } },
    })
    const created = db.rbacUserRole.create.mock.calls[0][0].data
    expect(created.roleId).toBe('role_db')
    expect(created.scopeType).toBe('inherit')
    expect(created.id).toBe('oidc_fixed')
    expect(created.tenantId).toBe('default')
  })

  it('demotes the OIDC row to the default role when no group matches (full re-sync)', async () => {
    // Unlike LDAP, OIDC always resolves a concrete role, so leaving every
    // mapped group reverts the user to the default role on the next login.
    db = makeDb({ rbacRole: { findUnique: vi.fn().mockResolvedValue({ id: 'role_viewer' }) } })
    await syncOidcRoleAssignment(
      db,
      baseParams({ groups: ['unmapped'], config: makeConfig({ db: 'role_db' }, 'role_viewer') }),
    )

    expect(db.rbacUserRole.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'u1', tenantId: 'default', id: { startsWith: 'oidc_' } },
    })
    const created = db.rbacUserRole.create.mock.calls[0][0].data
    expect(created.roleId).toBe('role_viewer')
    expect(created.scopeType).toBe('inherit')
  })

  it('falls back to role_viewer when the resolved role no longer exists', async () => {
    db = makeDb({ rbacRole: { findUnique: vi.fn().mockResolvedValue(null) } })
    await syncOidcRoleAssignment(db, baseParams({ config: makeConfig({ db: 'role_ghost' }) }))
    const created = db.rbacUserRole.create.mock.calls[0][0].data
    expect(created.roleId).toBe('role_viewer')
    expect(created.scopeType).toBe('inherit')
  })
})
