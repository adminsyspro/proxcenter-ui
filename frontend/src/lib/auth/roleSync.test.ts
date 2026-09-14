import { describe, it, expect, vi } from 'vitest'

import { syncProviderRoleAssignment } from './roleSync'

const NOW = new Date('2026-09-14T10:00:00Z')

type Row = { id: string; userId: string; tenantId: string; expiresAt?: Date | null }

/**
 * Enough of a Prisma `where` evaluator to run the sync against real rows rather
 * than a canned findFirst answer — the ownership rules the sync encodes are
 * about WHICH rows match, so a mock that answers the same thing to every query
 * cannot tell them apart.
 */
function matches(row: Row, where: any): boolean {
  if (where.userId && row.userId !== where.userId) return false
  if (where.tenantId && row.tenantId !== where.tenantId) return false
  if (where.id?.startsWith && !row.id.startsWith(where.id.startsWith)) return false
  if (where.NOT && matches(row, where.NOT)) return false
  if (where.OR && !where.OR.some((w: any) => matches(row, w))) return false
  if ('expiresAt' in where) {
    const expiry = row.expiresAt ?? null
    if (where.expiresAt === null) return expiry === null
    if (where.expiresAt?.gt) return expiry !== null && expiry > where.expiresAt.gt
  }
  return true
}

function makeDb(rows: Row[]) {
  return {
    rbacRole: { findUnique: vi.fn(async ({ where }: any) => ({ id: where.id })) },
    rbacUserRole: {
      findFirst: vi.fn(async ({ where }: any) => rows.find(r => matches(r, where)) ?? null),
      deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
      create: vi.fn().mockResolvedValue({}),
    },
    $transaction: vi.fn().mockResolvedValue([]),
  } as any
}

const params = (extra: any = {}) => ({
  userId: 'u1',
  resolvedRoleId: 'role_operator' as string | null,
  defaultRoleId: 'role_viewer',
  now: NOW,
  idPrefix: 'oidc_',
  newId: () => 'oidc_new',
  ...extra,
})

const row = (id: string, extra: Partial<Row> = {}): Row => ({
  id,
  userId: 'u1',
  tenantId: 'default',
  expiresAt: null,
  ...extra,
})

describe('syncProviderRoleAssignment — who owns the role', () => {
  it('stands down when an admin-granted row replaced the provider row', async () => {
    const db = makeDb([row('tenant_role_default_u1_abc123')])
    await syncProviderRoleAssignment(db, params())

    expect(db.rbacUserRole.deleteMany).not.toHaveBeenCalled()
    expect(db.rbacUserRole.create).not.toHaveBeenCalled()
  })

  it('applies its own mapping when the only row belongs to the OTHER provider', async () => {
    // An account moved from LDAP to OIDC keeps its ldap_ row (nothing deletes
    // it), and that row must not read as an admin takeover — the new provider
    // is authoritative and its mapping has to win.
    const db = makeDb([row('ldap_leftover')])
    await syncProviderRoleAssignment(db, params())

    expect(db.rbacUserRole.deleteMany).toHaveBeenCalledWith({
      where: { userId: 'u1', tenantId: 'default', id: { startsWith: 'oidc_' } },
    })
    expect(db.rbacUserRole.create.mock.calls[0][0].data.roleId).toBe('role_operator')
  })

  it('ignores an expired admin grant, which grants nothing any more', async () => {
    const db = makeDb([
      row('assign_u1_expired', { expiresAt: new Date('2026-09-13T10:00:00Z') }),
    ])
    await syncProviderRoleAssignment(db, params())

    expect(db.rbacUserRole.create.mock.calls[0][0].data.roleId).toBe('role_operator')
  })

  it('still stands down for an admin grant that has not expired yet', async () => {
    const db = makeDb([
      row('assign_u1_live', { expiresAt: new Date('2026-09-15T10:00:00Z') }),
    ])
    await syncProviderRoleAssignment(db, params())

    expect(db.rbacUserRole.create).not.toHaveBeenCalled()
  })

  it('replaces the provider row while the provider still owns it', async () => {
    const db = makeDb([row('oidc_previous')])
    await syncProviderRoleAssignment(db, params())

    expect(db.rbacUserRole.deleteMany).toHaveBeenCalled()
    expect(db.rbacUserRole.create.mock.calls[0][0].data.roleId).toBe('role_operator')
  })

  it('seeds the provider row when the user holds nothing at all', async () => {
    const db = makeDb([])
    await syncProviderRoleAssignment(db, params())

    expect(db.rbacUserRole.create.mock.calls[0][0].data.roleId).toBe('role_operator')
  })
})

describe('syncProviderRoleAssignment — no role resolved', () => {
  it('seeds the default role when the user only holds an expired grant', async () => {
    const db = makeDb([
      row('assign_u1_expired', { expiresAt: new Date('2026-09-13T10:00:00Z') }),
    ])
    await syncProviderRoleAssignment(db, params({ resolvedRoleId: null }))

    expect(db.rbacUserRole.create.mock.calls[0][0].data.roleId).toBe('role_viewer')
  })

  it('preserves a live assignment', async () => {
    const db = makeDb([row('tenant_role_default_u1_abc123')])
    await syncProviderRoleAssignment(db, params({ resolvedRoleId: null }))

    expect(db.rbacUserRole.create).not.toHaveBeenCalled()
  })
})
