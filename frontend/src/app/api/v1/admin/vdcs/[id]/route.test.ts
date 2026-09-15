/**
 * PUT /api/v1/admin/vdcs/[id]: provider-only vDC update. Pins the
 * storagePolicies passthrough (exact vlanPools/sharedBridges pattern
 * already forwarded by this route) and the createVdc-shared error mapping
 * (mapCreateVdcError kept REAL) for storage-policy rejections.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { callRoute } from '@/__tests__/setup/route-test'

const {
  requireProviderTenantMock, checkPermissionMock, getVdcByIdMock, updateVdcMock,
  deleteVdcMock, auditMock, listBindingsForVdcMock, unbindFromVdcMock,
} = vi.hoisted(() => ({
  requireProviderTenantMock: vi.fn(),
  checkPermissionMock: vi.fn(),
  getVdcByIdMock: vi.fn(),
  updateVdcMock: vi.fn(),
  deleteVdcMock: vi.fn(),
  auditMock: vi.fn(),
  listBindingsForVdcMock: vi.fn(),
  unbindFromVdcMock: vi.fn(),
}))

vi.mock('@/lib/tenant', () => ({
  requireProviderTenant: (...a: unknown[]) => requireProviderTenantMock(...a),
}))

vi.mock('@/lib/rbac', () => ({
  checkPermission: (...a: unknown[]) => checkPermissionMock(...a),
  PERMISSIONS: { ADMIN_SETTINGS: 'admin.settings' },
}))

vi.mock('@/lib/vdc', () => ({
  getVdcById: (...a: unknown[]) => getVdcByIdMock(...a),
  updateVdc: (...a: unknown[]) => updateVdcMock(...a),
  deleteVdc: (...a: unknown[]) => deleteVdcMock(...a),
}))

vi.mock('@/lib/db/vdcPbsBindings', () => ({
  listBindingsForVdc: (...a: unknown[]) => listBindingsForVdcMock(...a),
}))

vi.mock('@/lib/vdc/pbsOrchestrator', () => ({
  unbindFromVdc: (...a: unknown[]) => unbindFromVdcMock(...a),
}))

vi.mock('@/lib/audit', () => ({ audit: (...a: unknown[]) => auditMock(...a) }))

vi.mock('next-auth', () => ({
  getServerSession: vi.fn().mockResolvedValue({ user: { id: 'admin-1' } }),
}))

vi.mock('@/lib/auth/config', () => ({ authOptions: {} }))

import { PUT } from './route'

beforeEach(() => {
  vi.clearAllMocks()
  requireProviderTenantMock.mockResolvedValue(null)
  checkPermissionMock.mockResolvedValue(null)
  updateVdcMock.mockResolvedValue({ id: 'vdc-1', name: 'ACME' })
  listBindingsForVdcMock.mockResolvedValue([])
})

describe('PUT /api/v1/admin/vdcs/[id]', () => {
  it('forwards storagePolicies to updateVdc', async () => {
    const storagePolicies = [{ policyId: 'policy-1', quotaMb: 2048 }]
    const res = await callRoute(PUT as Parameters<typeof callRoute>[0], {
      method: 'PUT',
      params: { id: 'vdc-1' },
      body: { storagePolicies },
    })

    expect(res.status).toBe(200)
    expect(updateVdcMock).toHaveBeenCalledWith('vdc-1', expect.objectContaining({ storagePolicies }))
  })

  it('forwards an empty storagePolicies array (purge) rather than dropping it', async () => {
    const res = await callRoute(PUT as Parameters<typeof callRoute>[0], {
      method: 'PUT',
      params: { id: 'vdc-1' },
      body: { storagePolicies: [] },
    })

    expect(res.status).toBe(200)
    expect(updateVdcMock).toHaveBeenCalledWith('vdc-1', expect.objectContaining({ storagePolicies: [] }))
  })

  it('leaves storagePolicies undefined when absent from the body', async () => {
    const res = await callRoute(PUT as Parameters<typeof callRoute>[0], {
      method: 'PUT',
      params: { id: 'vdc-1' },
      body: { name: 'Renamed' },
    })

    expect(res.status).toBe(200)
    expect(updateVdcMock).toHaveBeenCalledWith('vdc-1', expect.objectContaining({ storagePolicies: undefined }))
  })

  it('forwards object-shaped isoLibraries ({ storageId, allowUploads }) untouched to updateVdc (#894)', async () => {
    const isoLibraries = [{ storageId: 'isolib', allowUploads: true }, 'ro-lib']
    const res = await callRoute(PUT as Parameters<typeof callRoute>[0], {
      method: 'PUT', params: { id: 'vdc-1' }, body: { isoLibraries },
    })
    expect(res.status).toBe(200)
    expect(updateVdcMock).toHaveBeenCalledWith('vdc-1', expect.objectContaining({ isoLibraries }))
  })

  it('forwards isoLibraries to updateVdc, an empty array purges, absence leaves it undefined (#894)', async () => {
    let res = await callRoute(PUT as Parameters<typeof callRoute>[0], {
      method: 'PUT', params: { id: 'vdc-1' }, body: { isoLibraries: ['isolib'] },
    })
    expect(res.status).toBe(200)
    expect(updateVdcMock).toHaveBeenCalledWith('vdc-1', expect.objectContaining({ isoLibraries: ['isolib'] }))

    res = await callRoute(PUT as Parameters<typeof callRoute>[0], {
      method: 'PUT', params: { id: 'vdc-1' }, body: { isoLibraries: [] },
    })
    expect(res.status).toBe(200)
    expect(updateVdcMock).toHaveBeenCalledWith('vdc-1', expect.objectContaining({ isoLibraries: [] }))

    res = await callRoute(PUT as Parameters<typeof callRoute>[0], {
      method: 'PUT', params: { id: 'vdc-1' }, body: { name: 'Renamed' },
    })
    expect(res.status).toBe(200)
    expect(updateVdcMock).toHaveBeenCalledWith('vdc-1', expect.objectContaining({ isoLibraries: undefined }))
  })

  it('maps a storage-policy unassign-safety rejection from updateVdc to 409', async () => {
    updateVdcMock.mockRejectedValue(
      new Error('Cannot remove storage policy "Gold": VMs 100 still hold volumes on "ceph-nvme"')
    )

    const res = await callRoute(PUT as Parameters<typeof callRoute>[0], {
      method: 'PUT',
      params: { id: 'vdc-1' },
      body: { storagePolicies: [] },
    })
    expect(res.status).toBe(409)
  })

  it('maps a storage-policy cross-connection rejection from updateVdc to 400', async () => {
    updateVdcMock.mockRejectedValue(
      new Error('Storage policy policy-1 does not belong to this connection')
    )

    const res = await callRoute(PUT as Parameters<typeof callRoute>[0], {
      method: 'PUT',
      params: { id: 'vdc-1' },
      body: { storagePolicies: [{ policyId: 'policy-1', quotaMb: null }] },
    })
    expect(res.status).toBe(400)
  })
})

describe('PUT /api/v1/admin/vdcs/[id]: ISO library validation errors are 400 (#894)', () => {
  it('maps an unknown / non-ISO storage rejection from updateVdc to 400', async () => {
    updateVdcMock.mockRejectedValue(new Error('Storage "nope" does not exist on this cluster or does not hold ISO content'))
    const res = await callRoute(PUT as Parameters<typeof callRoute>[0], {
      method: 'PUT', params: { id: 'vdc-1' }, body: { isoLibraries: ['nope'] },
    })
    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/ISO content/)
  })

  it('maps a malformed ISO library id rejection from updateVdc to 400', async () => {
    updateVdcMock.mockRejectedValue(new Error('Invalid ISO library storage id "bad id"'))
    const res = await callRoute(PUT as Parameters<typeof callRoute>[0], {
      method: 'PUT', params: { id: 'vdc-1' }, body: { isoLibraries: ['bad id'] },
    })
    expect(res.status).toBe(400)
  })
})
