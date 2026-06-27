import { beforeEach, describe, expect, it, vi } from 'vitest'

import { callRoute } from '../../../../../__tests__/setup/route-test'

const {
  sessionMock,
  accessMock,
  findUniqueMock,
  txMock,
  updateManyMock,
  upsertMock,
  auditMock,
} = vi.hoisted(() => ({
  sessionMock: vi.fn(),
  accessMock: vi.fn(),
  findUniqueMock: vi.fn(),
  txMock: vi.fn(),
  updateManyMock: vi.fn(),
  upsertMock: vi.fn(),
  auditMock: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: () => sessionMock() }))
vi.mock('@/lib/auth/config', () => ({ authOptions: {} }))
vi.mock('@/lib/tenant', () => ({ userHasAccessToTenant: (...a: any[]) => accessMock(...a) }))
vi.mock('@/lib/audit', () => ({ audit: (...a: any[]) => auditMock(...a) }))
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    tenant: { findUnique: (...a: any[]) => findUniqueMock(...a) },
    userTenant: {
      updateMany: (...a: any[]) => updateManyMock(...a),
      upsert: (...a: any[]) => upsertMock(...a),
    },
    $transaction: (...a: any[]) => txMock(...a),
  },
}))
vi.mock('@/lib/cache/inventoryCache', () => ({ invalidateInventoryCache: vi.fn() }))
vi.mock('@/lib/cache/nodeIpCache', () => ({ invalidateNodeIpCache: vi.fn() }))
vi.mock('@/lib/connections/getConnection', () => ({ invalidateConnectionCache: vi.fn() }))

beforeEach(() => {
  sessionMock.mockReset().mockResolvedValue({ user: { id: 'u1', email: 'admin@x' } })
  accessMock.mockReset().mockResolvedValue(true)
  findUniqueMock.mockReset().mockResolvedValue({ id: 'tenant-aid', name: 'AID', enabled: true })
  updateManyMock.mockReset().mockReturnValue({ op: 'updateMany' })
  upsertMock.mockReset().mockReturnValue({ op: 'upsert' })
  txMock.mockReset().mockResolvedValue([])
  auditMock.mockReset().mockResolvedValue(undefined)
})

describe('POST /api/v1/auth/switch-tenant', () => {
  it('creates the membership when a super-admin switches to a tenant they do not yet belong to', async () => {
    // A super-admin sees every tenant in the switcher but only has a
    // user_tenants row for tenants created while already super-admin. Setting
    // the new default must upsert (not updateMany) so the switch isn't a
    // silent no-op when the row is missing.
    const { POST } = await import('./route')
    const res = await callRoute(POST, { body: { tenantId: 'tenant-aid' } })

    expect(res.status).toBe(200)
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId_tenantId: { userId: 'u1', tenantId: 'tenant-aid' } },
        update: { isDefault: true },
        create: expect.objectContaining({ userId: 'u1', tenantId: 'tenant-aid', isDefault: true }),
      }),
    )
  })

  it('clears the previous default before setting the new one', async () => {
    const { POST } = await import('./route')
    await callRoute(POST, { body: { tenantId: 'tenant-aid' } })

    expect(updateManyMock).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u1' }, data: { isDefault: false } }),
    )
  })

  it('rejects a tenant the user cannot access with 403 and writes nothing', async () => {
    accessMock.mockResolvedValue(false)
    const { POST } = await import('./route')
    const res = await callRoute(POST, { body: { tenantId: 'tenant-x' } })

    expect(res.status).toBe(403)
    expect(txMock).not.toHaveBeenCalled()
    expect(upsertMock).not.toHaveBeenCalled()
  })
})
