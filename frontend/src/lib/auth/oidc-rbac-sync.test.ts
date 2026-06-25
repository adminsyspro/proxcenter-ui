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
  // The IdP sent an actual groups array (authoritative) unless a test overrides it.
  groupsClaimIsArray: true,
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

describe('syncOidcRoleAssignment — preserve vs revoke (issue #442 regression)', () => {
  // A pre-existing assignment is represented by findFirst returning a row.
  const withExistingRole = () =>
    makeDb({
      rbacUserRole: {
        findFirst: vi.fn().mockResolvedValue({ id: 'manual_row' }),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        create: vi.fn().mockResolvedValue({}),
      },
    })

  it('preserves an existing role when no group mapping is configured', async () => {
    // Deployments that assign roles manually (empty group_role_mapping) must
    // never have the OIDC sync rewrite the role — that was the 1.4.4 demotion.
    const db = withExistingRole()
    await syncOidcRoleAssignment(
      db,
      baseParams({ groups: ['anything'], config: makeConfig({}, 'role_viewer') }),
    )
    expect(db.rbacUserRole.deleteMany).not.toHaveBeenCalled()
    expect(db.rbacUserRole.create).not.toHaveBeenCalled()
  })

  it('seeds the configured default role (not hardcoded viewer) for a first-login user when no mapping is configured', async () => {
    // findFirst → null (makeDb default) means the user has no role yet.
    const db = makeDb()
    await syncOidcRoleAssignment(
      db,
      baseParams({ groups: [], config: makeConfig({}, 'operator') }),
    )
    expect(db.rbacUserRole.deleteMany).not.toHaveBeenCalled()
    const created = db.rbacUserRole.create.mock.calls[0][0].data
    expect(created.roleId).toBe('role_operator')
    expect(created.scopeType).toBe('inherit')
  })

  it('preserves an existing role when the groups claim is absent / not an array, even with a mapping', async () => {
    // A missing or non-array groups claim is not authoritative: do not demote.
    const db = withExistingRole()
    await syncOidcRoleAssignment(
      db,
      baseParams({ groups: [], groupsClaimIsArray: false, config: makeConfig({ db: 'role_db' }, 'role_viewer') }),
    )
    expect(db.rbacUserRole.deleteMany).not.toHaveBeenCalled()
    expect(db.rbacUserRole.create).not.toHaveBeenCalled()
  })

  it('demotes to the default role when the IdP sends an empty groups array and a mapping exists (authoritative revoke)', async () => {
    const db = makeDb({ rbacRole: { findUnique: vi.fn().mockResolvedValue({ id: 'role_viewer' }) } })
    await syncOidcRoleAssignment(
      db,
      baseParams({ groups: [], groupsClaimIsArray: true, config: makeConfig({ db: 'role_db' }, 'role_viewer') }),
    )
    expect(db.rbacUserRole.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'u1', tenantId: 'default', id: { startsWith: 'oidc_' } },
    })
    const created = db.rbacUserRole.create.mock.calls[0][0].data
    expect(created.roleId).toBe('role_viewer')
  })

  it('seeds role_viewer when the configured default role no longer exists (first login, no mapping, Codex P2)', async () => {
    // A custom default role that was later deleted must not FK-fail the
    // first-login seed — fall back to role_viewer like the resolved-role branch.
    const db = makeDb({ rbacRole: { findUnique: vi.fn().mockResolvedValue(null) } })
    await syncOidcRoleAssignment(
      db,
      baseParams({ groups: [], config: makeConfig({}, 'role_ghost') }),
    )
    expect(db.rbacUserRole.deleteMany).not.toHaveBeenCalled()
    const created = db.rbacUserRole.create.mock.calls[0][0].data
    expect(created.roleId).toBe('role_viewer')
    expect(created.scopeType).toBe('inherit')
  })
})
