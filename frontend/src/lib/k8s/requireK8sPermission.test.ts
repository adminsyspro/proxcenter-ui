import { describe, it, expect, vi, beforeEach } from 'vitest'

const getServerLicenseMock = vi.fn()
const checkPermissionMock = vi.fn()
const isUserSuperAdminMock = vi.fn()
const getServerSessionMock = vi.fn()

vi.mock('@/lib/auth/requireEnterprise', () => ({ getServerLicense: (...a: any[]) => getServerLicenseMock(...a) }))
vi.mock('@/lib/rbac', () => ({
  checkPermission: (...a: any[]) => checkPermissionMock(...a),
  isUserSuperAdmin: (...a: any[]) => isUserSuperAdminMock(...a),
  PERMISSIONS: { K8S_VIEW: 'k8s.view', K8S_MANAGE: 'k8s.manage' },
}))
vi.mock('next-auth', () => ({ getServerSession: (...a: any[]) => getServerSessionMock(...a) }))
vi.mock('@/lib/auth/config', () => ({ authOptions: {} }))

import { requireK8sPermission } from './requireK8sPermission'

beforeEach(() => { vi.clearAllMocks() })

describe('requireK8sPermission', () => {
  it('Enterprise: delegates to checkPermission (allowed)', async () => {
    getServerLicenseMock.mockResolvedValue({ enterprise: true })
    checkPermissionMock.mockResolvedValue(null)
    expect(await requireK8sPermission('k8s.view')).toBeNull()
    expect(checkPermissionMock).toHaveBeenCalledWith('k8s.view', 'global')
  })
  it('Enterprise: denied -> returns checkPermission Response', async () => {
    getServerLicenseMock.mockResolvedValue({ enterprise: true })
    const resp = new Response('no', { status: 403 })
    checkPermissionMock.mockResolvedValue(resp)
    expect(await requireK8sPermission('k8s.view')).toBe(resp)
  })
  it('Community: super-admin allowed (does NOT call checkPermission)', async () => {
    getServerLicenseMock.mockResolvedValue({ enterprise: false })
    getServerSessionMock.mockResolvedValue({ user: { id: 'u1' } })
    isUserSuperAdminMock.mockResolvedValue(true)
    expect(await requireK8sPermission('k8s.view')).toBeNull()
    expect(checkPermissionMock).not.toHaveBeenCalled()
  })
  it('Community: non-super-admin denied with 403', async () => {
    getServerLicenseMock.mockResolvedValue({ enterprise: false })
    getServerSessionMock.mockResolvedValue({ user: { id: 'u2' } })
    isUserSuperAdminMock.mockResolvedValue(false)
    const r = await requireK8sPermission('k8s.view')
    expect(r).not.toBeNull()
    expect((r as Response).status).toBe(403)
  })
  it('Community: no session -> 403', async () => {
    getServerLicenseMock.mockResolvedValue({ enterprise: false })
    getServerSessionMock.mockResolvedValue(null)
    const r = await requireK8sPermission('k8s.view')
    expect((r as Response).status).toBe(403)
  })
})
