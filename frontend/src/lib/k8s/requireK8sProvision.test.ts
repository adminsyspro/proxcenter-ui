import { describe, it, expect, vi, beforeEach } from 'vitest'

const getServerLicenseMock = vi.fn()
const requireK8sPermissionMock = vi.fn()

vi.mock('@/lib/auth/requireEnterprise', () => ({ getServerLicense: (...a: any[]) => getServerLicenseMock(...a) }))
vi.mock('@/lib/k8s/requireK8sPermission', () => ({ requireK8sPermission: (...a: any[]) => requireK8sPermissionMock(...a) }))
vi.mock('@/lib/rbac', () => ({ PERMISSIONS: { K8S_PROVISION: 'k8s.provision' } }))

import { requireK8sProvision } from './requireK8sProvision'

beforeEach(() => { vi.clearAllMocks() })

describe('requireK8sProvision', () => {
  it('non-enterprise -> 403, does NOT consult requireK8sPermission', async () => {
    getServerLicenseMock.mockResolvedValue({ enterprise: false })
    const r = await requireK8sProvision()
    expect(r).not.toBeNull()
    expect((r as Response).status).toBe(403)
    expect(requireK8sPermissionMock).not.toHaveBeenCalled()
  })

  it('enterprise + permission granted -> null', async () => {
    getServerLicenseMock.mockResolvedValue({ enterprise: true })
    requireK8sPermissionMock.mockResolvedValue(null)
    const r = await requireK8sProvision()
    expect(r).toBeNull()
    expect(requireK8sPermissionMock).toHaveBeenCalledWith('k8s.provision')
  })

  it('enterprise + permission denied -> returns the denial response', async () => {
    getServerLicenseMock.mockResolvedValue({ enterprise: true })
    const denial = new Response('no', { status: 403 })
    requireK8sPermissionMock.mockResolvedValue(denial)
    const r = await requireK8sProvision()
    expect(r).toBe(denial)
  })

  it('non-enterprise Community super-admin is STILL denied (fail-closed, never Community)', async () => {
    getServerLicenseMock.mockResolvedValue({ enterprise: false })
    // Even if requireK8sPermission would have granted it (Community super-admin heritage),
    // requireK8sProvision must never reach it.
    requireK8sPermissionMock.mockResolvedValue(null)
    const r = await requireK8sProvision()
    expect((r as Response).status).toBe(403)
    expect(requireK8sPermissionMock).not.toHaveBeenCalled()
  })
})
