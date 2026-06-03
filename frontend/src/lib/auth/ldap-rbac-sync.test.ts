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
