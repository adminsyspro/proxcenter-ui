import { describe, expect, it, beforeEach } from 'vitest'

import { prismaTest, truncate } from '@/__tests__/setup/prisma-test'
import { touchTokenUsage } from './lastUsed'

async function seed(lastUsedAt: Date | null) {
  await prismaTest.apiToken.create({
    data: {
      id: 'tok_touch',
      tenantId: 'default',
      name: 't',
      tokenPrefix: 'pxc_touch000',
      tokenHash: 'h'.repeat(64),
      scopes: [],
      lastUsedAt,
    },
  })
}

describe('touchTokenUsage (conditional single UPDATE, D5)', () => {
  beforeEach(async () => {
    await truncate(['api_tokens', 'tenants'])
    const now = new Date()
    await prismaTest.tenant.create({
      data: { id: 'default', slug: 'default', name: 'Provider', createdAt: now, updatedAt: now },
    })
  })

  it('writes when last_used_at is null', async () => {
    await seed(null)
    await touchTokenUsage('tok_touch', '10.0.0.1')
    const row = await prismaTest.apiToken.findUnique({ where: { id: 'tok_touch' } })
    expect(row?.lastUsedAt).not.toBeNull()
    expect(row?.lastUsedIp).toBe('10.0.0.1')
  })

  it('writes when the stored value is older than one minute', async () => {
    const old = new Date(Date.now() - 2 * 60_000)
    await seed(old)
    await touchTokenUsage('tok_touch', '10.0.0.2')
    const row = await prismaTest.apiToken.findUnique({ where: { id: 'tok_touch' } })
    expect(row?.lastUsedAt!.getTime()).toBeGreaterThan(old.getTime())
    expect(row?.lastUsedIp).toBe('10.0.0.2')
  })

  it('does NOT write when the stored value is fresher than one minute, even called twice concurrently', async () => {
    const fresh = new Date(Date.now() - 10_000)
    await seed(fresh)
    await Promise.all([touchTokenUsage('tok_touch', '10.9.9.9'), touchTokenUsage('tok_touch', '10.9.9.9')])
    const row = await prismaTest.apiToken.findUnique({ where: { id: 'tok_touch' } })
    expect(row?.lastUsedAt!.getTime()).toBe(fresh.getTime())
    expect(row?.lastUsedIp).toBeNull()
  })
})
