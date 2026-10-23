import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

const { checkPermissionMock, getAuditLogsMock } = vi.hoisted(() => ({
  checkPermissionMock: vi.fn(),
  getAuditLogsMock: vi.fn(),
}))

vi.mock('@/lib/audit', () => ({ getAuditLogs: getAuditLogsMock }))
vi.mock('@/lib/rbac', () => ({
  checkPermission: checkPermissionMock,
  PERMISSIONS: { ADMIN_AUDIT: 'admin.audit' },
}))
vi.mock('@/lib/tenant', () => ({ getCurrentTenantId: async () => 'default' }))

import { GET } from './route'

beforeEach(() => {
  vi.clearAllMocks()
  checkPermissionMock.mockResolvedValue(null)
  getAuditLogsMock.mockResolvedValue({ data: [], total: 0 })
})

describe('GET /api/v1/audit', () => {
  it('passes the tenant and the filters to getAuditLogs, dropping empty ones', async () => {
    const res = await callRoute(GET, { searchParams: { category: 'auth', limit: '10' } })
    expect(res.status).toBe(200)
    expect(getAuditLogsMock).toHaveBeenCalledWith({ tenantId: 'default', limit: 10, offset: 0, category: 'auth', action: null, status: null })
  })

  it('keeps the page sizes the audit page asks for', async () => {
    for (const size of [25, 50, 100]) {
      await callRoute(GET, { searchParams: { limit: String(size), offset: String(size * 3) } })
      expect(getAuditLogsMock).toHaveBeenLastCalledWith(expect.objectContaining({ limit: size, offset: size * 3 }))
    }
  })

  it('clamps an oversized limit to 500 rows', async () => {
    await callRoute(GET, { searchParams: { limit: '1000000' } })
    expect(getAuditLogsMock).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 500 }))
  })

  it('falls back to 100 rows and offset 0 on absent, zero, negative or unparseable paging', async () => {
    await callRoute(GET)
    expect(getAuditLogsMock).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 100, offset: 0 }))

    for (const bad of ['0', '-5', 'abc', 'Infinity']) {
      await callRoute(GET, { searchParams: { limit: bad, offset: bad } })
      expect(getAuditLogsMock).toHaveBeenLastCalledWith(expect.objectContaining({ limit: 100, offset: 0 }))
    }
  })

  it('answers "Server error" when the read throws without a message', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    getAuditLogsMock.mockRejectedValue({})
    const res = await callRoute(GET)
    expect(res.status).toBe(500)
    expect((await readJson<any>(res)).error).toBe('Server error')
    expect(errorSpy).toHaveBeenCalledWith('GET audit error:', {})
  })
})
