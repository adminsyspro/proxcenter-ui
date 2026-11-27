/**
 * roadmap#278: the reports.manage migration. Report writes used to need only
 * reports.view, so the migration hands the new write right to the system
 * write roles and to the custom roles (or direct grants) that already manage
 * alerts, never to a read-only set. Replayed here on seeded rows; the SQL is
 * idempotent, so running it a second time changes nothing.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'

import { beforeEach, describe, expect, it } from 'vitest'

import { prismaTest, testSchema, truncate } from '@/__tests__/setup/prisma-test'

const SQL = readFileSync(
  path.resolve(__dirname, '../../../prisma/migrations/20261127120000_reports_manage_permission/migration.sql'),
  'utf8',
)

async function runMigration() {
  const statements = SQL.split(/;\s*\n/).map(s => s.trim()).filter(Boolean)
  await prismaTest.$transaction(async tx => {
    await tx.$executeRawUnsafe(`SET LOCAL search_path TO "${testSchema}"`)
    for (const s of statements) await tx.$executeRawUnsafe(s)
  })
}

const now = new Date()

async function role(id: string, permissions: string[], isSystem = false) {
  await prismaTest.rbacRole.create({
    data: { id, name: id, isSystem, createdAt: now, updatedAt: now, permissions: { create: permissions.map(permissionId => ({ permissionId })) } },
  })
}

async function userPerm(userId: string, permissionId: string, scopeType = 'global', scopeTarget: string | null = null, expiresAt: Date | null = null) {
  await prismaTest.rbacUserPermission.create({
    data: { id: `${userId}-${permissionId}-${scopeType}`, userId, permissionId, scopeType, scopeTarget, tenantId: 'default', grantedAt: now, expiresAt },
  })
}

async function rolesHolding(permissionId: string) {
  const rows = await prismaTest.rbacRolePermission.findMany({ where: { permissionId }, select: { roleId: true } })
  return rows.map(r => r.roleId).sort((a, b) => a.localeCompare(b))
}

beforeEach(async () => {
  await truncate(['rbac_user_permissions', 'rbac_role_permissions', 'users'])
  await prismaTest.rbacRole.deleteMany({})
  const ids = ['reports.view', 'alerts.manage', 'vm.view']
  // Another file may have left a row with one of these names under another id
  // (the test schema is shared); it would break the upsert on the unique name.
  await prismaTest.rbacPermission.deleteMany({ where: { OR: [{ id: 'reports.manage' }, { name: 'reports.manage' }, { name: { in: ids }, id: { notIn: ids } }] } })
  for (const id of ids) {
    await prismaTest.rbacPermission.upsert({ where: { id }, update: {}, create: { id, name: id, category: 'operations' } })
  }
  for (const id of ['writer', 'reader', 'other']) {
    await prismaTest.user.create({ data: { id, email: `${id}@example.com`, createdAt: now, updatedAt: now } })
  }
})

describe('20261127120000_reports_manage_permission', () => {
  it('creates the permission, flagged dangerous', async () => {
    await runMigration()
    const p = await prismaTest.rbacPermission.findUnique({ where: { id: 'reports.manage' } })
    expect(p).toMatchObject({ category: 'operations', isDangerous: true })
  })

  it('grants the system write roles and the custom roles that also manage alerts, not the read-only ones', async () => {
    await role('role_operator', ['reports.view'], true)
    await role('role_tenant_admin', ['reports.view', 'alerts.manage'], true)
    await role('role_viewer', ['reports.view'], true)
    await role('custom_ops', ['reports.view', 'alerts.manage'])
    await role('custom_reader', ['reports.view'])
    await role('custom_alerts_only', ['alerts.manage'])

    await runMigration()

    expect(await rolesHolding('reports.manage')).toEqual(['custom_ops', 'role_operator', 'role_tenant_admin'])
  })

  it('mirrors a direct reports.view grant only when the same user manages alerts on the same scope', async () => {
    await userPerm('writer', 'reports.view', 'connection', 'c1')
    await userPerm('writer', 'alerts.manage', 'connection', 'c1')
    await userPerm('reader', 'reports.view')
    await userPerm('other', 'reports.view', 'connection', 'c1')
    await userPerm('other', 'alerts.manage', 'connection', 'c2')

    await runMigration()

    const granted = await prismaTest.rbacUserPermission.findMany({
      where: { permissionId: 'reports.manage' },
      select: { userId: true, scopeType: true, scopeTarget: true },
    })
    expect(granted).toEqual([{ userId: 'writer', scopeType: 'connection', scopeTarget: 'c1' }])
  })

  it('never outlives the alerts.manage grant it was derived from', async () => {
    const soon = new Date(Date.now() + 86_400_000)
    const later = new Date(Date.now() + 30 * 86_400_000)
    await userPerm('writer', 'reports.view', 'global', null, later)
    await userPerm('writer', 'alerts.manage', 'global', null, soon)
    await userPerm('reader', 'reports.view', 'global', null, null)
    await userPerm('reader', 'alerts.manage', 'global', null, soon)
    await userPerm('other', 'reports.view', 'global', null, soon)
    await userPerm('other', 'alerts.manage', 'global', null, null)

    await runMigration()

    const expiry = async (userId: string) =>
      (await prismaTest.rbacUserPermission.findFirst({ where: { userId, permissionId: 'reports.manage' } }))?.expiresAt?.getTime() ?? null
    expect(await expiry('writer')).toBe(soon.getTime())
    expect(await expiry('reader')).toBe(soon.getTime())
    expect(await expiry('other')).toBe(soon.getTime())
  })

  it('is idempotent', async () => {
    await role('custom_ops', ['reports.view', 'alerts.manage'])
    await userPerm('writer', 'reports.view')
    await userPerm('writer', 'alerts.manage')

    await runMigration()
    await runMigration()

    expect(await rolesHolding('reports.manage')).toEqual(['custom_ops'])
    expect(await prismaTest.rbacUserPermission.count({ where: { permissionId: 'reports.manage' } })).toBe(1)
  })
})
