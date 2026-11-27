import { describe, it, expect, vi, beforeEach } from 'vitest'

const scopeMock = vi.fn()
const checkPermissionMock = vi.fn()
vi.mock('@/lib/tenant/infraScope', () => ({ getTenantInfrastructureScope: (...a: any[]) => scopeMock(...a) }))
vi.mock('@/lib/rbac', () => ({
  PERMISSIONS: { VM_CREATE: 'vm.create', VM_DELETE: 'vm.delete' },
  checkPermission: (...a: any[]) => checkPermissionMock(...a),
}))

import { requireProvisionTarget } from './provisionAccess'

beforeEach(() => {
  scopeMock.mockReset().mockResolvedValue({ kind: 'provider' })
  checkPermissionMock.mockReset().mockResolvedValue(null)
})

describe('requireProvisionTarget', () => {
  it('lets the provider deploy on any connection it holds vm.create on', async () => {
    expect(await requireProvisionTarget('default', 'c1', 'create')).toBeNull()
    expect(checkPermissionMock).toHaveBeenCalledWith('vm.create', 'connection', 'c1')
  })
  it('asks for vm.delete to destroy', async () => {
    await requireProvisionTarget('default', 'c1', 'delete')
    expect(checkPermissionMock).toHaveBeenCalledWith('vm.delete', 'connection', 'c1')
  })
  it('passes on a permission refusal', async () => {
    checkPermissionMock.mockResolvedValue(new Response('no', { status: 403 }))
    expect((await requireProvisionTarget('default', 'c1', 'create'))?.status).toBe(403)
  })
  it('lets a tenant that owns connections deploy on its own only', async () => {
    scopeMock.mockResolvedValue({ kind: 'msp', connectionIds: new Set(['mine']) })
    expect(await requireProvisionTarget('t1', 'mine', 'create')).toBeNull()
    const refused = await requireProvisionTarget('t1', 'theirs', 'create')
    expect(refused?.status).toBe(404)
    expect(await refused?.json()).toEqual({ error: 'connection_not_found' })
  })
  it('refuses a tenant that rents a vDC, before any permission check', async () => {
    scopeMock.mockResolvedValue({ kind: 'iaas', vdcScope: {} })
    const refused = await requireProvisionTarget('t2', 'c1', 'create')
    expect(refused?.status).toBe(403)
    expect(await refused?.json()).toEqual({ error: 'tenant_vdc_unsupported' })
    expect(checkPermissionMock).not.toHaveBeenCalled()
  })
})
