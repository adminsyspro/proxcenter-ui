import { describe, expect, it, beforeEach } from 'vitest'

import { prismaTest, truncate } from '@/__tests__/setup/prisma-test'
import { ALL_PERMISSIONS } from '../../../prisma/roleCatalogue'
import { PERMISSIONS } from '@/lib/rbac'

describe('api_tokens schema', () => {
  beforeEach(async () => {
    await truncate(['api_tokens', 'audit_logs', 'tenants'])
    const now = new Date()
    await prismaTest.tenant.create({
      data: { id: 'default', slug: 'default', name: 'Provider', createdAt: now, updatedAt: now },
    })
  })

  it('creates and reads an ApiToken row with defaults', async () => {
    const row = await prismaTest.apiToken.create({
      data: {
        id: 'tok_1',
        tenantId: 'default',
        name: 'prometheus-prod',
        tokenPrefix: 'pxc_abcd1234',
        tokenHash: 'a'.repeat(64),
        scopes: ['vms:read'],
        connectionIds: null,
      },
    })
    expect(row.rateLimitPerMin).toBe(600)
    expect(row.revokedAt).toBeNull()
    expect(row.expiresAt).toBeNull()
    const found = await prismaTest.apiToken.findUnique({ where: { tokenPrefix: 'pxc_abcd1234' } })
    expect(found?.id).toBe('tok_1')
    expect(found?.scopes).toEqual(['vms:read'])
  })

  it('rejects a duplicate token_prefix', async () => {
    const data = {
      tenantId: 'default',
      name: 't',
      tokenPrefix: 'pxc_dup00000',
      scopes: [],
    }
    await prismaTest.apiToken.create({ data: { ...data, id: 'tok_a', tokenHash: 'h1' } })
    await expect(
      prismaTest.apiToken.create({ data: { ...data, id: 'tok_b', tokenHash: 'h2' } }),
    ).rejects.toThrow()
  })

  it('stores api_token_id on audit_logs, nullable and without FK', async () => {
    await prismaTest.auditLog.create({
      data: {
        id: 'audit_1',
        tenantId: 'default',
        timestamp: new Date(),
        action: 'create',
        category: 'api_tokens',
        apiTokenId: 'tok_deleted_long_ago',
      },
    })
    const row = await prismaTest.auditLog.findUnique({ where: { id: 'audit_1' } })
    expect(row?.apiTokenId).toBe('tok_deleted_long_ago')
  })

  it('declares admin.apitokens in BOTH permission lists (no sdn.vnet-style drift)', () => {
    expect(ALL_PERMISSIONS.some(p => p.id === 'admin.apitokens')).toBe(true)
    expect(PERMISSIONS.ADMIN_APITOKENS).toBe('admin.apitokens')
  })
})
