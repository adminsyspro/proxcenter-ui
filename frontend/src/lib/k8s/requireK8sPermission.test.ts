import { describe, it, expect, vi, beforeEach } from 'vitest'

const checkPermissionMock = vi.fn()

vi.mock('@/lib/rbac', () => ({
  checkPermission: (...a: any[]) => checkPermissionMock(...a),
  PERMISSIONS: { K8S_VIEW: 'k8s.view', K8S_PROVISION: 'k8s.provision' },
}))

import { _impl } from '@/lib/auth/requireEnterprise'
import { requireK8sPermission } from './requireK8sPermission'
import { requireK8sProvision } from './requireK8sProvision'

const license = (over: Record<string, unknown>) =>
  vi.spyOn(_impl, 'getServerLicense').mockResolvedValue({
    enterprise: false, edition: 'community', licensed: false, expired: false, features: [], options: [], ...over,
  } as any)

beforeEach(() => {
  vi.restoreAllMocks()
  checkPermissionMock.mockReset().mockResolvedValue(null)
})

describe('requireK8sPermission', () => {
  it('Enterprise: the RBAC permission decides', async () => {
    license({ enterprise: true, edition: 'enterprise', licensed: true })
    expect(await requireK8sPermission('k8s.view')).toBeNull()
    expect(checkPermissionMock).toHaveBeenCalledWith('k8s.view', 'global')
    const denial = new Response('no', { status: 403 })
    checkPermissionMock.mockResolvedValue(denial)
    expect(await requireK8sPermission('k8s.view')).toBe(denial)
  })
  it('Enterprise Plus carries Kubernetes too', async () => {
    license({ enterprise: true, edition: 'enterprise_plus', licensed: true })
    expect(await requireK8sPermission('k8s.view')).toBeNull()
  })
  it('Community: 403 for everyone, super-admins included, without asking RBAC', async () => {
    license({})
    const r = await requireK8sPermission('k8s.view')
    expect(r?.status).toBe(403)
    expect(await r?.json()).toEqual({ error: 'Feature not licensed', feature: 'kubernetes' })
    expect(checkPermissionMock).not.toHaveBeenCalled()
  })
  it('an expired Enterprise licence is refused', async () => {
    license({ enterprise: false, edition: 'enterprise', licensed: true, expired: true })
    expect((await requireK8sPermission('k8s.view'))?.status).toBe(403)
  })
})

describe('requireK8sProvision', () => {
  it('asks for k8s.provision on Enterprise', async () => {
    license({ enterprise: true, edition: 'enterprise', licensed: true })
    expect(await requireK8sProvision()).toBeNull()
    expect(checkPermissionMock).toHaveBeenCalledWith('k8s.provision', 'global')
  })
  it('refuses on Community', async () => {
    license({})
    expect((await requireK8sProvision())?.status).toBe(403)
    expect(checkPermissionMock).not.toHaveBeenCalled()
  })
})
