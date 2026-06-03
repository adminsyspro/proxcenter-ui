import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

const { getServerSessionMock, isSuperAdminMock, findFirstMock, findUniqueMock, createMock, txMock } = vi.hoisted(() => ({
  getServerSessionMock: vi.fn(),
  isSuperAdminMock: vi.fn(),
  findFirstMock: vi.fn(),
  findUniqueMock: vi.fn(),
  createMock: vi.fn((args: any) => args),
  txMock: vi.fn().mockResolvedValue([]),
}))

vi.mock('next-auth', () => ({ getServerSession: getServerSessionMock }))
vi.mock('@/lib/auth/config', () => ({ authOptions: {} }))
vi.mock('@/lib/demo/demo-api', () => ({ demoResponse: () => null }))
vi.mock('@/lib/tenant', () => ({ getCurrentTenantId: async () => 'default' }))
vi.mock('@/lib/audit', () => ({ audit: vi.fn() }))
vi.mock('@/lib/rbac', () => ({ isUserSuperAdmin: isSuperAdminMock, PROTECTED_ROLE_IDS: [] }))
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    rbacRole: { findFirst: findFirstMock, findUnique: findUniqueMock, create: createMock },
    rbacRolePermission: { createMany: vi.fn((a: any) => a) },
    $transaction: txMock,
  },
}))

import { POST } from './route'

// Shape returned by the post-create re-fetch the response maps over.
const newRoleRow = (defaultScopes: any) => ({
  id: 'role_new',
  name: 'DB Admin',
  description: null,
  isSystem: false,
  color: '#fff',
  widgetOverrides: null,
  defaultScopes,
  tenantId: 'default',
  createdAt: new Date('2026-06-03T00:00:00Z'),
  updatedAt: new Date('2026-06-03T00:00:00Z'),
  permissions: [],
})

describe('POST /api/v1/rbac/roles default_scopes (issue #383)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getServerSessionMock.mockResolvedValue({ user: { id: 'admin', email: 'a@x' } })
    isSuperAdminMock.mockResolvedValue(true)
    findFirstMock.mockResolvedValue(null)
    txMock.mockResolvedValue([])
  })

  it('stores a valid default scope on the new role', async () => {
    findUniqueMock.mockResolvedValue(newRoleRow([{ scopeType: 'tag', scopeTarget: 'db' }]))
    const res = await callRoute(POST, {
      body: { name: 'DB Admin', default_scopes: [{ scopeType: 'tag', scopeTarget: 'db' }] },
    })
    expect(res.status).toBe(201)
    expect(createMock).toHaveBeenCalled()
    expect(createMock.mock.calls[0][0].data.defaultScopes).toEqual([{ scopeType: 'tag', scopeTarget: 'db' }])
  })

  it('rejects an invalid default scope type', async () => {
    const res = await callRoute(POST, {
      body: { name: 'Bad Role', default_scopes: [{ scopeType: 'global', scopeTarget: null }] },
    })
    expect(res.status).toBe(400)
    const json: any = await readJson(res)
    expect(json.error).toMatch(/default_scope/i)
  })

  it('omits defaultScopes when none provided', async () => {
    findUniqueMock.mockResolvedValue(newRoleRow(null))
    const res = await callRoute(POST, { body: { name: 'Plain Role' } })
    expect(res.status).toBe(201)
    expect(createMock.mock.calls[0][0].data.defaultScopes).toBeUndefined()
  })
})
