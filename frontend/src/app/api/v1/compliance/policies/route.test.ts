import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { callRoute, deniedPermissionResponse, readJson } from '@/__tests__/setup/route-test'

const { checkPermissionMock, sessionMock, updateMock, getMock, auditMock, getCollectionMock, saveCollectionMock } = vi.hoisted(() => ({
  checkPermissionMock: vi.fn(),
  sessionMock: vi.fn(),
  updateMock: vi.fn(),
  getMock: vi.fn(),
  auditMock: vi.fn(),
  getCollectionMock: vi.fn(),
  saveCollectionMock: vi.fn(),
}))

vi.mock('next-auth', () => ({ getServerSession: () => sessionMock() }))
vi.mock('@/lib/auth/config', () => ({ authOptions: {} }))
vi.mock('@/lib/rbac', () => ({
  checkPermission: checkPermissionMock,
  PERMISSIONS: { ADMIN_COMPLIANCE: 'admin.compliance' },
}))
vi.mock('@/lib/demo/demo-api', () => ({ demoResponse: () => null }))
vi.mock('@/lib/tenant', () => ({ getCurrentTenantId: async () => 'default' }))
vi.mock('@/lib/audit', () => ({ audit: auditMock }))
vi.mock('@/lib/audit/withAudit', () => ({ withAudit: (_spec: unknown, handler: unknown) => handler }))
vi.mock('@/lib/compliance/policies', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/compliance/policies')>()

  return { ...actual, getSecurityPolicies: getMock, updateSecurityPolicies: updateMock }
})

vi.mock('@/lib/compliance/collectionSettingsStore', () => ({
  getCollectionSettings: getCollectionMock,
  saveCollectionSettings: saveCollectionMock,
}))

import { GET, PUT } from './route'

const saved = { id: 'default', audit_retention_days: 45, audit_auto_cleanup: true }
// The compliance collection settings ride along with the policies.
const collection = { compliance_cache_minutes: 5, compliance_guest_concurrency: 4 }

beforeEach(() => {
  vi.clearAllMocks()
  checkPermissionMock.mockResolvedValue(null)
  sessionMock.mockResolvedValue({ user: { id: 'u1' } })
  updateMock.mockResolvedValue(saved)
  getMock.mockResolvedValue(saved)
  getCollectionMock.mockResolvedValue({ cacheMinutes: 5, guestConcurrency: 4 })
  saveCollectionMock.mockImplementation(async (_t: string, patch: object) => ({ cacheMinutes: 5, guestConcurrency: 4, ...patch }))
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('PUT /api/v1/compliance/policies', () => {
  it('saves the payload for the session user and audits it', async () => {
    const res = await callRoute(PUT, { method: 'PUT', body: { audit_retention_days: 45 } })

    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual({ data: { ...saved, ...collection } })
    expect(updateMock).toHaveBeenCalledWith({ audit_retention_days: 45 }, 'u1', 'default')
    expect(saveCollectionMock).not.toHaveBeenCalled()
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'update', category: 'security', details: { audit_retention_days: 45 } }))
  })

  it('answers 400 with a code when the retention is under the floor, without auditing', async () => {
    updateMock.mockRejectedValue(new Error('E_AUDIT_RETENTION_TOO_SHORT'))

    const res = await callRoute(PUT, { method: 'PUT', body: { audit_retention_days: 7 } })

    expect(res.status).toBe(400)
    expect(await readJson(res)).toEqual({
      error: 'Audit retention must be a whole number of days, at least 30.',
      code: 'E_AUDIT_RETENTION_TOO_SHORT',
    })
    expect(auditMock).not.toHaveBeenCalled()
  })

  it('saves the compliance collection settings of the tenant', async () => {
    const res = await callRoute(PUT, { method: 'PUT', body: { compliance_cache_minutes: 15, compliance_guest_concurrency: 2 } })

    expect(res.status).toBe(200)
    expect(saveCollectionMock).toHaveBeenCalledWith('default', { cacheMinutes: 15, guestConcurrency: 2 })
    expect(await readJson(res)).toEqual({ data: { ...saved, compliance_cache_minutes: 15, compliance_guest_concurrency: 2 } })
  })

  it('refuses collection settings out of bounds before writing anything', async () => {
    const res = await callRoute(PUT, { method: 'PUT', body: { audit_retention_days: 45, compliance_guest_concurrency: 50 } })

    expect(res.status).toBe(400)
    expect((await readJson<{ code: string }>(res))?.code).toBe('E_COLLECTION_SETTINGS_INVALID')
    expect(updateMock).not.toHaveBeenCalled()
    expect(saveCollectionMock).not.toHaveBeenCalled()
    expect(auditMock).not.toHaveBeenCalled()
  })

  it('keeps the 409 of the 2FA guard', async () => {
    updateMock.mockRejectedValue(new Error('E_NEED_OWN_2FA'))

    const res = await callRoute(PUT, { method: 'PUT', body: { require_2fa_for_super_admin: true } })

    expect(res.status).toBe(409)
    expect((await readJson<{ code: string }>(res))?.code).toBe('E_NEED_OWN_2FA')
  })

  it('refuses a caller without the compliance permission', async () => {
    checkPermissionMock.mockResolvedValue(deniedPermissionResponse())

    const res = await callRoute(PUT, { method: 'PUT', body: { audit_retention_days: 45 } })

    expect(res.status).toBe(403)
    expect(updateMock).not.toHaveBeenCalled()
  })

  it('refuses a caller without a session', async () => {
    sessionMock.mockResolvedValue(null)

    expect((await callRoute(PUT, { method: 'PUT', body: {} })).status).toBe(401)
    expect(updateMock).not.toHaveBeenCalled()
  })

  it('answers 500 on any other failure', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    updateMock.mockRejectedValue(new Error('db down'))

    const res = await callRoute(PUT, { method: 'PUT', body: { audit_retention_days: 45 } })

    expect(res.status).toBe(500)
    expect((await readJson<{ error: string }>(res))?.error).toBe('db down')
  })
})

describe('GET /api/v1/compliance/policies', () => {
  it('returns the policies of the current tenant', async () => {
    const res = await callRoute(GET)

    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual({ data: { ...saved, ...collection } })
    expect(getMock).toHaveBeenCalledWith('default')
    expect(getCollectionMock).toHaveBeenCalledWith('default')
  })
})
