import { beforeEach, describe, expect, it, vi } from 'vitest'

import { callRoute, deniedPermissionResponse, readJson } from '@/__tests__/setup/route-test'

const { checkPermissionMock, policyMock } = vi.hoisted(() => ({
  checkPermissionMock: vi.fn(),
  policyMock: vi.fn(),
}))

vi.mock('@/lib/rbac', () => ({
  checkPermission: checkPermissionMock,
  PERMISSIONS: { ADMIN_AUDIT: 'admin.audit' },
}))
vi.mock('@/lib/compliance/policies', () => ({ getAuditRetentionPolicy: policyMock }))

import { GET } from './route'

beforeEach(() => {
  vi.clearAllMocks()
  checkPermissionMock.mockResolvedValue(null)
  policyMock.mockResolvedValue({ autoCleanup: true, retentionDays: 90 })
})

describe('GET /api/v1/audit/retention', () => {
  it('returns the global retention policy to a holder of the audit permission', async () => {
    const res = await callRoute(GET)

    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual({ data: { autoCleanup: true, retentionDays: 90 } })
    expect(checkPermissionMock).toHaveBeenCalledWith('admin.audit')
    expect(policyMock).toHaveBeenCalledWith('default')
  })

  it('refuses a caller without the audit permission before reading the policy', async () => {
    checkPermissionMock.mockResolvedValue(deniedPermissionResponse())

    const res = await callRoute(GET)

    expect(res.status).toBe(403)
    expect(policyMock).not.toHaveBeenCalled()
  })

  it('answers 500 when the policy cannot be read', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    policyMock.mockRejectedValue(new Error('db down'))

    const res = await callRoute(GET)

    expect(res.status).toBe(500)
    expect((await readJson<{ error: string }>(res))?.error).toBe('db down')
    errorSpy.mockRestore()
  })
})
