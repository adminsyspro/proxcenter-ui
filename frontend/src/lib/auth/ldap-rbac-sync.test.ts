import { describe, it, expect, vi, beforeEach } from 'vitest'

import { syncLdapRoleAssignment } from './ldap'

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

const params = (extra: any = {}) => ({
  userId: 'u1',
  resolvedRoleId: null as string | null,
  defaultRoleId: 'role_viewer',
  now: new Date('2026-06-03T00:00:00Z'),
  newId: () => 'ldap_fixed',
  ...extra,
})

describe('syncLdapRoleAssignment (issue #383)', () => {
  let db: any
  beforeEach(() => {
    db = makeDb()
  })

  it('replaces the LDAP-managed row with the resolved role as an inherit assignment', async () => {
    await syncLdapRoleAssignment(db, params({ resolvedRoleId: 'role_db' }))

    // Only ldap_-owned rows are removed, never manual assignments.
    expect(db.rbacUserRole.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'u1', tenantId: 'default', id: { startsWith: 'ldap_' } },
    })
    const created = db.rbacUserRole.create.mock.calls[0][0].data
    expect(created.roleId).toBe('role_db')
    expect(created.scopeType).toBe('inherit')
    expect(created.id).toBe('ldap_fixed')
    expect(created.tenantId).toBe('default')
  })

  it('falls back to role_viewer when the resolved role does not exist', async () => {
    db = makeDb({ rbacRole: { findUnique: vi.fn().mockResolvedValue(null) } })
    await syncLdapRoleAssignment(db, params({ resolvedRoleId: 'role_ghost' }))
    const created = db.rbacUserRole.create.mock.calls[0][0].data
    expect(created.roleId).toBe('role_viewer')
    expect(created.scopeType).toBe('inherit')
  })

  it('assigns the default role on first login when no role exists (inherit)', async () => {
    await syncLdapRoleAssignment(db, params({ resolvedRoleId: null }))
    expect(db.rbacUserRole.deleteMany).not.toHaveBeenCalled()
    const created = db.rbacUserRole.create.mock.calls[0][0].data
    expect(created.roleId).toBe('role_viewer')
    expect(created.scopeType).toBe('inherit')
  })

  it('preserves an existing role when no LDAP group matches', async () => {
    db = makeDb({
      rbacUserRole: {
        findFirst: vi.fn().mockResolvedValue({ id: 'manual_1' }),
        deleteMany: vi.fn(),
        create: vi.fn(),
      },
    })
    await syncLdapRoleAssignment(db, params({ resolvedRoleId: null }))
    expect(db.rbacUserRole.create).not.toHaveBeenCalled()
    expect(db.rbacUserRole.deleteMany).not.toHaveBeenCalled()
  })
})

describe('syncLdapRoleAssignment — admin takeover from the Users dialog', () => {
  // Same ownership rule as OIDC: the Users dialog wipes the `ldap_` row along
  // with the rest, so its absence next to a standing assignment means an admin
  // now owns the role and a matching LDAP group must not re-add a second row.
  const makeDbWithRows = (providerRow: any, anyRow: any) =>
    makeDb({
      rbacUserRole: {
        findFirst: vi.fn(async (args: any) =>
          args?.where?.id?.startsWith ? providerRow : anyRow,
        ),
        deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        create: vi.fn().mockResolvedValue({}),
      },
    })

  it('leaves a manually assigned role alone when the LDAP row is gone', async () => {
    const db = makeDbWithRows(null, { id: 'tenant_role_default_u1_abc123' })
    await syncLdapRoleAssignment(db, params({ resolvedRoleId: 'role_db' }))

    expect(db.rbacUserRole.deleteMany).not.toHaveBeenCalled()
    expect(db.rbacUserRole.create).not.toHaveBeenCalled()
  })

  it('still replaces the LDAP row while the directory owns it', async () => {
    const db = makeDbWithRows({ id: 'ldap_previous' }, { id: 'ldap_previous' })
    await syncLdapRoleAssignment(db, params({ resolvedRoleId: 'role_db' }))

    expect(db.rbacUserRole.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'u1', tenantId: 'default', id: { startsWith: 'ldap_' } },
    })
    expect(db.rbacUserRole.create.mock.calls[0][0].data.roleId).toBe('role_db')
  })
})
