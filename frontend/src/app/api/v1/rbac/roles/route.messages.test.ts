import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

const { getServerSessionMock, isSuperAdminMock, findFirstMock, findUniqueMock, createMock, txMock } = vi.hoisted(() => ({
  getServerSessionMock: vi.fn(),
  isSuperAdminMock: vi.fn(),
  findFirstMock: vi.fn(),
  findUniqueMock: vi.fn(),
  createMock: vi.fn((args: any) => args),
  txMock: vi.fn(),
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

import { GET, POST } from './route'

beforeEach(() => {
  vi.clearAllMocks()
  vi.spyOn(console, 'error').mockImplementation(() => {})
  getServerSessionMock.mockResolvedValue({ user: { id: 'admin', email: 'a@x' } })
  isSuperAdminMock.mockResolvedValue(true)
  findFirstMock.mockResolvedValue(null)
  findUniqueMock.mockResolvedValue(null)
  txMock.mockResolvedValue([])
})

async function expectError(res: Response, status: number, message: string) {
  expect(res.status).toBe(status)
  expect((await readJson<any>(res)).error).toBe(message)
}

describe('GET /api/v1/rbac/roles messages', () => {
  it('401 "Unauthorized" without a session', async () => {
    getServerSessionMock.mockResolvedValue(null)
    await expectError(await callRoute(GET as any), 401, 'Unauthorized')
  })

  it('500 "Server error" when a lookup throws without a message', async () => {
    isSuperAdminMock.mockRejectedValue(new Error(''))
    await expectError(await callRoute(GET as any), 500, 'Server error')
  })
})

describe('POST /api/v1/rbac/roles messages', () => {
  it('401 "Unauthorized" without a session', async () => {
    getServerSessionMock.mockResolvedValue(null)
    await expectError(await callRoute(POST as any, { body: { name: 'R' } }), 401, 'Unauthorized')
  })

  it('403 "Admin rights required" for a non-super-admin', async () => {
    isSuperAdminMock.mockResolvedValue(false)
    await expectError(await callRoute(POST as any, { body: { name: 'R' } }), 403, 'Admin rights required')
  })

  it('400 "Role name is required"', async () => {
    await expectError(await callRoute(POST as any, { body: { name: '   ' } }), 400, 'Role name is required')
  })

  it('400 "A role with this name already exists"', async () => {
    findFirstMock.mockResolvedValue({ id: 'role_old' })
    await expectError(await callRoute(POST as any, { body: { name: 'R' } }), 400, 'A role with this name already exists')
  })

  it('500 "Creation failed" when the new role cannot be read back', async () => {
    await expectError(await callRoute(POST as any, { body: { name: 'R' } }), 500, 'Creation failed')
  })

  it('500 "Server error" when the transaction throws without a message', async () => {
    txMock.mockRejectedValue(new Error(''))
    await expectError(await callRoute(POST as any, { body: { name: 'R' } }), 500, 'Server error')
  })
})
