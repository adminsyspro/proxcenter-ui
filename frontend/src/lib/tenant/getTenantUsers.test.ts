import { beforeEach, describe, expect, it, vi } from 'vitest'

const { userTenantFindManyMock, rbacUserRoleFindManyMock } = vi.hoisted(() => ({
  userTenantFindManyMock: vi.fn(),
  rbacUserRoleFindManyMock: vi.fn(),
}))

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    userTenant: { findMany: userTenantFindManyMock },
    rbacUserRole: { findMany: rbacUserRoleFindManyMock },
  },
}))

import { getTenantUsers } from './index'

const member = (id: string, role = 'user') => ({
  userId: id,
  isDefault: false,
  joinedAt: new Date('2026-01-01T00:00:00Z'),
  user: { id, email: `${id}@x.test`, name: id, role, enabled: true },
})
const grant = (userId: string, id: string, name: string, isSystem = false) => ({ userId, role: { id, name, isSystem } })

beforeEach(() => {
  userTenantFindManyMock.mockReset().mockResolvedValue([member('u1', 'admin'), member('u2')])
  rbacUserRoleFindManyMock.mockReset().mockImplementation(async ({ where }: any) =>
    where.roleId === 'role_super_admin' ? [{ userId: 'u2' }] : [],
  )
})

describe('getTenantUsers: rbac_roles (roadmap#65)', () => {
  it('returns the active RBAC roles held in the tenant per user, deduplicated, keeping the legacy role', async () => {
    rbacUserRoleFindManyMock.mockImplementation(async ({ where }: any) => {
      if (where.roleId === 'role_super_admin') return [{ userId: 'u2' }]
      return [
        grant('u1', 'role_admin', 'Admin', true),
        grant('u1', 'role_admin', 'Admin', true),
        grant('u1', 'role_custom', 'Operators'),
        grant('u2', 'role_super_admin', 'Super Admin', true),
      ]
    })

    const users = await getTenantUsers('t1')

    expect(users[0]).toMatchObject({ id: 'u1', role: 'admin', is_super_admin: false })
    expect(users[0].rbac_roles).toEqual([
      { id: 'role_admin', name: 'Admin', is_system: true },
      { id: 'role_custom', name: 'Operators', is_system: false },
    ])
    expect(users[1]).toMatchObject({ id: 'u2', role: 'user', is_super_admin: true })
    expect(users[1].rbac_roles).toEqual([{ id: 'role_super_admin', name: 'Super Admin', is_system: true }])
  })

  it('returns an empty list for a member with no grant in the tenant', async () => {
    const users = await getTenantUsers('t1')
    expect(users.map(u => u.rbac_roles)).toEqual([[], []])
  })

  it('reads only the active grants of this tenant', async () => {
    await getTenantUsers('t1')
    const where = rbacUserRoleFindManyMock.mock.calls.map(c => c[0].where).find((w: any) => w.tenantId)
    expect(where).toMatchObject({
      userId: { in: ['u1', 'u2'] },
      tenantId: 't1',
      OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }],
    })
  })

  it('skips the grant queries for a tenant with no member', async () => {
    userTenantFindManyMock.mockResolvedValue([])
    expect(await getTenantUsers('t1')).toEqual([])
    expect(rbacUserRoleFindManyMock).not.toHaveBeenCalled()
  })
})
