/**
 * Service accounts (issue #1404) against the real schema: a flagged users
 * row, member of its tenant, with no password, whose tokens, roles and
 * membership go when it is deleted.
 */
import { beforeEach, describe, expect, it } from 'vitest'

import { prismaTest, truncate } from '@/__tests__/setup/prisma-test'
import { seedApiToken, seedDefaultTenant } from '@/__tests__/setup/apiTokens'

import {
  createServiceAccount,
  deleteServiceAccount,
  getServiceAccount,
  isServiceAccountEmail,
  listServiceAccounts,
  ServiceAccountError,
  updateServiceAccount,
} from './index'

const now = new Date()

beforeEach(async () => {
  await truncate(['api_tokens', 'rbac_user_roles', 'user_tenants', 'users', 'tenants'])
  await seedDefaultTenant()
  await prismaTest.tenant.create({ data: { id: 'acme', slug: 'acme', name: 'Acme', operatingModel: 'iaas', createdAt: now, updatedAt: now } })
  await prismaTest.tenant.create({ data: { id: 'off', slug: 'off', name: 'Off', operatingModel: 'iaas', enabled: false, createdAt: now, updatedAt: now } })
  await prismaTest.rbacRole.upsert({ where: { id: 'role_tenant_admin' }, update: {}, create: { id: 'role_tenant_admin', name: 'Tenant Admin', isSystem: true, createdAt: now, updatedAt: now } })
})

async function refusal(promise: Promise<unknown>): Promise<{ status: number; message: string }> {
  try {
    await promise
  } catch (e) {
    expect(e).toBeInstanceOf(ServiceAccountError)
    return { status: (e as ServiceAccountError).status, message: (e as Error).message }
  }
  throw new Error('expected a refusal')
}

describe('createServiceAccount', () => {
  it('creates a password-less account flagged as a service account, member of its tenant', async () => {
    const sa = await createServiceAccount({ tenantId: 'acme', name: '  ci-onboarding ', description: 'OpenTofu' })

    expect(sa).toMatchObject({ tenantId: 'acme', tenantName: 'Acme', name: 'ci-onboarding', description: 'OpenTofu', enabled: true, roles: [], tokenCount: 0, lastUsedAt: null })
    const row = await prismaTest.user.findUnique({ where: { id: sa.id } })
    expect(row).toMatchObject({ serviceAccount: true, password: null, authProvider: 'service_account', tenantId: 'acme', totpEnabled: false })
    expect(isServiceAccountEmail(row!.email)).toBe(true)
    expect(await prismaTest.userTenant.findUnique({ where: { userId_tenantId: { userId: sa.id, tenantId: 'acme' } } })).not.toBeNull()
  })

  it('refuses an empty or too long name, a missing or disabled tenant, a name already taken in the tenant', async () => {
    expect((await refusal(createServiceAccount({ tenantId: 'acme', name: '  ' }))).status).toBe(400)
    expect((await refusal(createServiceAccount({ tenantId: 'acme', name: 'x'.repeat(65) }))).status).toBe(400)
    expect((await refusal(createServiceAccount({ tenantId: 'nope', name: 'ci' }))).status).toBe(404)
    expect((await refusal(createServiceAccount({ tenantId: 'off', name: 'ci' }))).status).toBe(404)
    await createServiceAccount({ tenantId: 'acme', name: 'ci' })
    expect(await refusal(createServiceAccount({ tenantId: 'acme', name: 'CI' }))).toMatchObject({ status: 409 })
    await expect(createServiceAccount({ tenantId: 'default', name: 'ci' })).resolves.toMatchObject({ tenantId: 'default' })
  })
})

describe('listServiceAccounts and getServiceAccount', () => {
  it('lists the accounts of a tenant, or of every tenant, never a human user', async () => {
    await prismaTest.user.create({ data: { id: 'human', email: 'h@x.io', tenantId: 'acme', createdAt: now, updatedAt: now } })
    const a = await createServiceAccount({ tenantId: 'acme', name: 'b-ci' })
    const p = await createServiceAccount({ tenantId: 'default', name: 'provider-ci' })

    expect((await listServiceAccounts('acme')).map(s => s.id)).toEqual([a.id])
    expect((await listServiceAccounts(null)).map(s => s.id).sort()).toEqual([a.id, p.id].sort())
    expect(await getServiceAccount('human')).toBeNull()
  })

  it('counts its tokens, reports the last use and lists its roles', async () => {
    const sa = await createServiceAccount({ tenantId: 'acme', name: 'ci' })
    await seedApiToken({ tenantId: 'acme', serviceAccountId: sa.id })
    const used = await seedApiToken({ tenantId: 'acme', serviceAccountId: sa.id })
    const at = new Date('2026-11-19T10:00:00Z')
    await prismaTest.apiToken.update({ where: { id: used.id }, data: { lastUsedAt: at } })
    await prismaTest.rbacUserRole.create({
      data: { id: 'a1', userId: sa.id, roleId: 'role_tenant_admin', scopeType: 'global', tenantId: 'acme', grantedAt: now },
    })

    const view = await getServiceAccount(sa.id)
    expect(view).toMatchObject({ tokenCount: 2, lastUsedAt: at.toISOString() })
    expect(view!.roles).toEqual([expect.objectContaining({ id: 'a1', roleId: 'role_tenant_admin', scopeType: 'global' })])
  })
})

describe('updateServiceAccount', () => {
  it('renames, describes, disables; refuses a taken name, a non boolean and an unknown account', async () => {
    const sa = await createServiceAccount({ tenantId: 'acme', name: 'ci' })
    await createServiceAccount({ tenantId: 'acme', name: 'other' })

    expect(await updateServiceAccount(sa.id, { name: 'ci-2', description: '', enabled: false }))
      .toMatchObject({ name: 'ci-2', description: null, enabled: false })
    expect((await refusal(updateServiceAccount(sa.id, { name: 'OTHER' }))).status).toBe(409)
    expect((await refusal(updateServiceAccount(sa.id, { enabled: 'no' }))).status).toBe(400)
    expect((await refusal(updateServiceAccount('nope', { name: 'x' }))).status).toBe(404)
  })

  it('never touches a human user', async () => {
    await prismaTest.user.create({ data: { id: 'human', email: 'h@x.io', createdAt: now, updatedAt: now } })
    expect((await refusal(updateServiceAccount('human', { enabled: false }))).status).toBe(404)
    expect((await prismaTest.user.findUnique({ where: { id: 'human' } }))!.enabled).toBe(true)
  })
})

describe('deleteServiceAccount', () => {
  it('removes the account with its tokens, roles and membership', async () => {
    const sa = await createServiceAccount({ tenantId: 'acme', name: 'ci' })
    const token = await seedApiToken({ tenantId: 'acme', serviceAccountId: sa.id })
    await prismaTest.rbacUserRole.create({
      data: { id: 'a1', userId: sa.id, roleId: 'role_tenant_admin', scopeType: 'global', tenantId: 'acme', grantedAt: now },
    })

    expect(await deleteServiceAccount(sa.id)).toEqual({ name: 'ci' })
    expect(await prismaTest.apiToken.findUnique({ where: { id: token.id } })).toBeNull()
    expect(await prismaTest.rbacUserRole.findUnique({ where: { id: 'a1' } })).toBeNull()
    expect(await prismaTest.userTenant.count({ where: { userId: sa.id } })).toBe(0)
  })

  it('refuses a human user or an unknown id', async () => {
    await prismaTest.user.create({ data: { id: 'human', email: 'h@x.io', createdAt: now, updatedAt: now } })
    expect((await refusal(deleteServiceAccount('human'))).status).toBe(404)
    expect((await refusal(deleteServiceAccount('nope'))).status).toBe(404)
  })
})
