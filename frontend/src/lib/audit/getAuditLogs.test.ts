import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers()) }))
vi.mock('next-auth', () => ({ getServerSession: vi.fn(async () => null) }))
vi.mock('@/lib/auth/config', () => ({ authOptions: {} }))

import { prismaTest, truncate } from '@/__tests__/setup/prisma-test'
import { seedApiToken, seedDefaultTenant } from '@/__tests__/setup/apiTokens'
import { prisma } from '@/lib/db/prisma'
import { getAuditLogs } from './index'

async function seedRow(id: string, minutesAgo: number, fields: Record<string, unknown>) {
  await prismaTest.auditLog.create({
    data: {
      id,
      tenantId: 'default',
      timestamp: new Date(Date.now() - minutesAgo * 60_000),
      action: 'apitoken.write',
      category: 'api_tokens',
      status: 'success',
      ...fields,
    },
  })
}

beforeEach(async () => {
  await truncate(['audit_logs', 'api_tokens', 'tenants'])
  await seedDefaultTenant()
})

describe('getAuditLogs, token actors', () => {
  it('joins the name and prefix of the token that wrote a row, null for a deleted token or a user row', async () => {
    const live = await seedApiToken()
    await seedRow('row-live', 1, { apiTokenId: live.id })
    await seedRow('row-live-2', 2, { apiTokenId: live.id })
    await seedRow('row-gone', 3, { apiTokenId: 'tok_deleted_long_ago' })
    await seedRow('row-user', 4, { userId: 'user-1', userEmail: 'admin@example.com', action: 'login', category: 'auth' })

    const findMany = vi.spyOn(prisma.apiToken, 'findMany')
    const { data } = await getAuditLogs({ tenantId: 'default' })
    const byId = Object.fromEntries(data.map(row => [row.id, row]))

    expect(byId['row-live']).toMatchObject({
      api_token_id: live.id,
      api_token_name: `test-${live.id}`,
      api_token_prefix: live.prefix,
      user_email: null,
    })
    expect(byId['row-live-2']).toMatchObject({ api_token_id: live.id, api_token_name: `test-${live.id}` })
    expect(byId['row-gone']).toMatchObject({ api_token_id: 'tok_deleted_long_ago', api_token_name: null, api_token_prefix: null })
    expect(byId['row-user']).toMatchObject({ api_token_id: null, api_token_name: null, api_token_prefix: null, user_email: 'admin@example.com' })

    // One lookup for the whole page, over the distinct ids only (no N+1).
    expect(findMany).toHaveBeenCalledTimes(1)
    const ids = (findMany.mock.calls[0][0] as any).where.id.in
    expect([...ids].sort()).toEqual([live.id, 'tok_deleted_long_ago'].sort())
    findMany.mockRestore()
  })

  it('skips the token lookup when no row on the page came from a token', async () => {
    await seedRow('row-user', 1, { userId: 'user-1', userEmail: 'admin@example.com', action: 'login', category: 'auth' })
    const findMany = vi.spyOn(prisma.apiToken, 'findMany')
    const { data } = await getAuditLogs({ tenantId: 'default' })
    expect(data).toHaveLength(1)
    expect(findMany).not.toHaveBeenCalled()
    findMany.mockRestore()
  })
})
