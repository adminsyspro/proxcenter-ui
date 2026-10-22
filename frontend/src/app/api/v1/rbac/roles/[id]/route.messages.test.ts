import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

const { getServerSessionMock, isSuperAdminMock, findUniqueMock, findFirstMock, deleteMock, countMock, txMock } = vi.hoisted(() => ({
  getServerSessionMock: vi.fn(),
  isSuperAdminMock: vi.fn(),
  findUniqueMock: vi.fn(),
  findFirstMock: vi.fn(),
  deleteMock: vi.fn(),
  countMock: vi.fn(),
  txMock: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: getServerSessionMock }))
vi.mock('@/lib/auth/config', () => ({ authOptions: {} }))
vi.mock('@/lib/demo/demo-api', () => ({ demoResponse: () => null }))
vi.mock('@/lib/tenant', () => ({ getCurrentTenantId: async () => 'default' }))
vi.mock('@/lib/audit', () => ({ audit: vi.fn() }))
vi.mock('@/lib/rbac', () => ({ isUserSuperAdmin: isSuperAdminMock, PROTECTED_ROLE_IDS: ['super_admin'] }))
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    rbacRole: { findUnique: findUniqueMock, findFirst: findFirstMock, delete: deleteMock },
    rbacUserRole: { count: countMock },
    $transaction: txMock,
  },
}))

import { GET, PATCH, DELETE } from './route'

const PARAMS = { id: 'role_db' }

const roleRow = (over: Record<string, unknown> = {}) => ({
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
  userRoles: [],
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  getServerSessionMock.mockResolvedValue({ user: { id: 'admin', email: 'a@x' } })
  isSuperAdminMock.mockResolvedValue(true)
  findUniqueMock.mockResolvedValue(roleRow())
  findFirstMock.mockResolvedValue(null)
  deleteMock.mockResolvedValue({})
  countMock.mockResolvedValue(0)
  txMock.mockResolvedValue(undefined)
})

async function expectError(res: Response, status: number, message: string) {
  expect(res.status).toBe(status)
  expect((await readJson<any>(res)).error).toBe(message)
}

describe('GET /api/v1/rbac/roles/[id] messages', () => {
  const call = (id = 'role_db') => callRoute(GET as any, { params: { id } })

  it('200 returns the role', async () => {
    expect((await call()).status).toBe(200)
  })

  it('401 "Unauthorized" without a session', async () => {
    getServerSessionMock.mockResolvedValue(null)
    await expectError(await call(), 401, 'Unauthorized')
  })

  it('404 "Role not found" for a protected role read by a non-super-admin', async () => {
    isSuperAdminMock.mockResolvedValue(false)
    await expectError(await call('super_admin'), 404, 'Role not found')
  })

  it('404 "Role not found" when the role is missing', async () => {
    findUniqueMock.mockResolvedValue(null)
    await expectError(await call(), 404, 'Role not found')
  })

  it('500 "Server error" when the lookup throws without a message', async () => {
    findUniqueMock.mockRejectedValue(new Error(''))
    await expectError(await call(), 500, 'Server error')
  })
})

describe('PATCH /api/v1/rbac/roles/[id] messages', () => {
  const call = (body: Record<string, unknown>) => callRoute(PATCH as any, { method: 'PATCH', params: PARAMS, body })

  it('401 "Unauthorized" without a session', async () => {
    getServerSessionMock.mockResolvedValue(null)
    await expectError(await call({ name: 'X' }), 401, 'Unauthorized')
  })

  it('403 "Admin rights required" for a non-super-admin', async () => {
    isSuperAdminMock.mockResolvedValue(false)
    await expectError(await call({ name: 'X' }), 403, 'Admin rights required')
  })

  it('404 "Role not found" when the role belongs to another tenant', async () => {
    findUniqueMock.mockResolvedValue(roleRow({ tenantId: 'tenant-b' }))
    await expectError(await call({ name: 'X' }), 404, 'Role not found')
  })

  it('400 "Cannot modify a system role"', async () => {
    findUniqueMock.mockResolvedValue(roleRow({ isSystem: true, tenantId: null }))
    await expectError(await call({ name: 'X' }), 400, 'Cannot modify a system role')
  })

  it('400 "A role with this name already exists"', async () => {
    findFirstMock.mockResolvedValue({ id: 'role_other' })
    await expectError(await call({ name: 'X' }), 400, 'A role with this name already exists')
  })

  it('404 "Role not found" when the role vanishes after the update', async () => {
    findUniqueMock.mockResolvedValueOnce(roleRow()).mockResolvedValueOnce(null)
    await expectError(await call({ name: 'X' }), 404, 'Role not found')
  })

  it('500 "Server error" when the transaction throws without a message', async () => {
    txMock.mockRejectedValue(new Error(''))
    await expectError(await call({ name: 'X' }), 500, 'Server error')
  })
})

describe('DELETE /api/v1/rbac/roles/[id] messages', () => {
  const call = () => callRoute(DELETE as any, { method: 'DELETE', params: PARAMS })

  it('200 deletes an unused custom role', async () => {
    expect((await call()).status).toBe(200)
  })

  it('401 "Unauthorized" without a session', async () => {
    getServerSessionMock.mockResolvedValue(null)
    await expectError(await call(), 401, 'Unauthorized')
  })

  it('403 "Admin rights required" for a non-super-admin', async () => {
    isSuperAdminMock.mockResolvedValue(false)
    await expectError(await call(), 403, 'Admin rights required')
  })

  it('404 "Role not found" when the role is missing', async () => {
    findUniqueMock.mockResolvedValue(null)
    await expectError(await call(), 404, 'Role not found')
  })

  it('400 "Cannot delete a system role"', async () => {
    findUniqueMock.mockResolvedValue(roleRow({ isSystem: true, tenantId: null }))
    await expectError(await call(), 400, 'Cannot delete a system role')
  })

  it('400 when the role is still assigned', async () => {
    countMock.mockResolvedValue(3)
    await expectError(await call(), 400, 'This role is assigned to 3 user(s). Remove the assignments first.')
  })

  it('500 "Server error" when the delete throws without a message', async () => {
    deleteMock.mockRejectedValue(new Error(''))
    await expectError(await call(), 500, 'Server error')
  })
})
