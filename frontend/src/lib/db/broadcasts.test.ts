import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { prismaTest, truncate } from '@/__tests__/setup/prisma-test'
import { prisma } from '@/lib/db/prisma'
import {
  createBroadcast,
  deleteBroadcast,
  listActiveForPrincipal,
  listBroadcasts,
  resolvePrincipalRoles,
  updateBroadcast,
} from './broadcasts'

const NOW = new Date('2026-08-01T12:00:00.000Z')

const input = (over: Record<string, unknown> = {}) => ({
  message: 'Maintenance 22:00 UTC',
  bgColor: '#f59e0b',
  fgColor: '#000000',
  dismissible: true,
  enabled: true,
  startsAt: null,
  endsAt: null,
  targetKind: 'all' as const,
  targetIds: [] as string[],
  ...over,
})

const principal = { userId: 'u1', tenantId: 'tenant-a', roleIds: ['role_viewer'], legacyRole: null }

// Fixtures for resolvePrincipalRoles, which reads real `users`/`rbac_roles`/
// `rbac_user_roles` rows (both FKs are enforced, so a grant needs its user
// and role to exist first).
async function seedUser(id: string, role?: string) {
  await prismaTest.user.create({
    data: { id, email: `${id}@example.com`, ...(role ? { role } : {}), createdAt: new Date(), updatedAt: new Date() },
  })
}

async function seedRole(id: string) {
  await prismaTest.rbacRole.create({ data: { id, name: id, createdAt: new Date(), updatedAt: new Date() } })
}

beforeEach(async () => {
  await truncate(['broadcast_messages', 'rbac_user_roles', 'rbac_roles', 'users'])
})

afterAll(async () => {
  await prismaTest.$disconnect()
})

describe('broadcast repository', () => {
  it('creates a row, stamps the author and lists it', async () => {
    const created = await createBroadcast(input(), 'admin-1')
    expect(created.createdBy).toBe('admin-1')
    const all = await listBroadcasts()
    expect(all).toHaveLength(1)
    expect(all[0].message).toBe('Maintenance 22:00 UTC')
  })

  it('orders the list by creation date, oldest first', async () => {
    await createBroadcast(input({ message: 'first' }), 'admin-1')
    await createBroadcast(input({ message: 'second' }), 'admin-1')
    expect((await listBroadcasts()).map(b => b.message)).toEqual(['first', 'second'])
  })

  it('updates a row and returns null for an unknown id', async () => {
    const created = await createBroadcast(input(), 'admin-1')
    const updated = await updateBroadcast(created.id, input({ message: 'changed' }))
    expect(updated?.message).toBe('changed')
    expect(await updateBroadcast('does-not-exist', input())).toBeNull()
  })

  it('rejects with the original error when the update fails for a reason other than a missing row', async () => {
    const boom = Object.assign(new Error('connection reset'), { code: 'P2002' })
    const spy = vi.spyOn(prisma.broadcastMessage, 'update').mockRejectedValueOnce(boom)
    try {
      await expect(updateBroadcast('any-id', input())).rejects.toBe(boom)
    } finally {
      spy.mockRestore()
    }
  })

  it('deletes a row and reports an unknown id', async () => {
    const created = await createBroadcast(input(), 'admin-1')
    expect(await deleteBroadcast(created.id)).toBe(true)
    expect(await deleteBroadcast(created.id)).toBe(false)
  })

  it('returns only matching banners, stripped of targeting metadata', async () => {
    await createBroadcast(input({ message: 'everyone' }), 'admin-1')
    await createBroadcast(input({ message: 'tenant-b only', targetKind: 'tenants', targetIds: ['tenant-b'] }), 'admin-1')
    await createBroadcast(input({ message: 'off', enabled: false }), 'admin-1')

    const active = await listActiveForPrincipal(principal, NOW)

    expect(active.map(b => b.message)).toEqual(['everyone'])
    expect(Object.keys(active[0]).sort()).toEqual(
      ['bgColor', 'dismissible', 'fgColor', 'id', 'message', 'updatedAt'].sort(),
    )
  })

  it('excludes a banner whose window is closed', async () => {
    await createBroadcast(input({ message: 'expired', endsAt: new Date('2026-07-31T00:00:00.000Z') }), 'admin-1')
    expect(await listActiveForPrincipal(principal, NOW)).toEqual([])
  })
})

describe('resolvePrincipalRoles', () => {
  it('returns only the grants for the given user+tenant, keeping a null or future expiresAt and dropping an expired one, another tenant\'s grant and another user\'s grant', async () => {
    await seedUser('rp-u1')
    await seedUser('rp-u2')
    await seedRole('rp-role-null')
    await seedRole('rp-role-future')
    await seedRole('rp-role-expired')
    await seedRole('rp-role-other-tenant')
    await seedRole('rp-role-other-user')

    await prismaTest.rbacUserRole.createMany({
      data: [
        { id: 'rp-g1', userId: 'rp-u1', roleId: 'rp-role-null', tenantId: 'rp-tenant', grantedAt: new Date(), expiresAt: null },
        { id: 'rp-g2', userId: 'rp-u1', roleId: 'rp-role-future', tenantId: 'rp-tenant', grantedAt: new Date(), expiresAt: new Date('2999-01-01') },
        { id: 'rp-g3', userId: 'rp-u1', roleId: 'rp-role-expired', tenantId: 'rp-tenant', grantedAt: new Date(), expiresAt: new Date('2000-01-01') },
        { id: 'rp-g4', userId: 'rp-u1', roleId: 'rp-role-other-tenant', tenantId: 'rp-other-tenant', grantedAt: new Date(), expiresAt: null },
        { id: 'rp-g5', userId: 'rp-u2', roleId: 'rp-role-other-user', tenantId: 'rp-tenant', grantedAt: new Date(), expiresAt: null },
      ],
    })

    const result = await resolvePrincipalRoles('rp-u1', 'rp-tenant')

    expect(result.roleIds.sort()).toEqual(['rp-role-future', 'rp-role-null'])
  })

  it('returns legacyRole: null when the user has no row in `users`', async () => {
    expect(await resolvePrincipalRoles('rp-ghost', 'rp-tenant')).toEqual({ roleIds: [], legacyRole: null })
  })

  it('returns the stored role as legacyRole when the user row exists', async () => {
    await seedUser('rp-u3', 'tenant_admin')
    expect(await resolvePrincipalRoles('rp-u3', 'rp-tenant')).toEqual({ roleIds: [], legacyRole: 'tenant_admin' })
  })
})
