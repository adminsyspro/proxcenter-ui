import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

const { getServerSessionMock, isSuperAdminMock, findUniqueMock, updateMock, txMock } = vi.hoisted(() => ({
  getServerSessionMock: vi.fn(),
  isSuperAdminMock: vi.fn(),
  findUniqueMock: vi.fn(),
  updateMock: vi.fn((a: any) => a),
  txMock: vi.fn(async (cb: any) => cb({
    rbacRole: { update: updateMock },
    rbacRolePermission: { deleteMany: vi.fn(), createMany: vi.fn() },
  })),
}))

vi.mock('next-auth', () => ({ getServerSession: getServerSessionMock }))
vi.mock('@/lib/auth/config', () => ({ authOptions: {} }))
vi.mock('@/lib/demo/demo-api', () => ({ demoResponse: () => null }))
vi.mock('@/lib/tenant', () => ({ getCurrentTenantId: async () => 'default' }))
vi.mock('@/lib/audit', () => ({ audit: vi.fn() }))
vi.mock('@/lib/rbac', () => ({ isUserSuperAdmin: isSuperAdminMock, PROTECTED_ROLE_IDS: [] }))
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    rbacRole: { findUnique: findUniqueMock, update: updateMock },
    $transaction: txMock,
  },
}))

import { PATCH } from './route'

// Complete row the initial fetch + post-update re-fetch (both findUnique) map over.
const roleRow = (over: any = {}) => ({
  id: 'role_db',
  name: 'DB',
  description: null,
  isSystem: false,
  color: '#fff',
  widgetOverrides: null,
  defaultScopes: null,
  tenantId: 'default',
  createdAt: new Date('2026-06-03T00:00:00Z'),
  updatedAt: new Date('2026-06-03T00:00:00Z'),
  permissions: [],
  ...over,
})

describe('PATCH /api/v1/rbac/roles/[id] default_scopes (issue #383)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    getServerSessionMock.mockResolvedValue({ user: { id: 'admin', email: 'a@x' } })
    isSuperAdminMock.mockResolvedValue(true)
  })

  it('rejects default_scopes on a system role', async () => {
    findUniqueMock.mockResolvedValue(roleRow({ id: 'role_viewer', isSystem: true, tenantId: null, name: 'Viewer' }))
    const res = await callRoute(PATCH, {
      method: 'PATCH',
      params: { id: 'role_viewer' },
      body: { default_scopes: [{ scopeType: 'tag', scopeTarget: 'db' }] },
    })
    expect(res.status).toBe(400)
    const json: any = await readJson(res)
    expect(json.error).toMatch(/système|system/i)
  })

  it('updates default_scopes on a custom role', async () => {
    findUniqueMock.mockResolvedValue(roleRow())
    const res = await callRoute(PATCH, {
      method: 'PATCH',
      params: { id: 'role_db' },
      body: { default_scopes: [{ scopeType: 'pool', scopeTarget: 'dbpool' }] },
    })
    expect(res.status).toBe(200)
    expect(updateMock).toHaveBeenCalled()
    const data = updateMock.mock.calls[0][0].data
    expect(data.defaultScopes).toEqual([{ scopeType: 'pool', scopeTarget: 'dbpool' }])
  })

  it('clears default_scopes when an empty list is sent', async () => {
    findUniqueMock.mockResolvedValue(roleRow())
    const res = await callRoute(PATCH, {
      method: 'PATCH',
      params: { id: 'role_db' },
      body: { default_scopes: [] },
    })
    expect(res.status).toBe(200)
    // empty list clears the scope -> Prisma.DbNull
    const data = updateMock.mock.calls[0][0].data
    expect(data.defaultScopes).toBeDefined()
  })

  it('clears default_scopes when explicit null is sent', async () => {
    findUniqueMock.mockResolvedValue(roleRow({ defaultScopes: [{ scopeType: 'tag', scopeTarget: 'db' }] }))
    const res = await callRoute(PATCH, {
      method: 'PATCH',
      params: { id: 'role_db' },
      body: { default_scopes: null },
    })
    expect(res.status).toBe(200)
    const data = updateMock.mock.calls[0][0].data
    expect(data.defaultScopes).toBeDefined()
  })

  it('rejects an invalid default_scopes payload on a custom role', async () => {
    findUniqueMock.mockResolvedValue(roleRow())
    const res = await callRoute(PATCH, {
      method: 'PATCH',
      params: { id: 'role_db' },
      body: { default_scopes: [{ scopeType: 'global', scopeTarget: null }] },
    })
    expect(res.status).toBe(400)
    const json: any = await readJson(res)
    expect(json.error).toMatch(/default_scope/i)
    expect(updateMock).not.toHaveBeenCalled()
  })
})
