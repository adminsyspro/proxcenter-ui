/**
 * GET/POST /api/v1/admin/connections/{id}/storage-policies and
 * PUT/DELETE .../{policyId}: provider-only storage-policy CRUD.
 *
 * Both route files share `storagePolicyProviderGuard` from the colocated
 * guard.ts (not a route: app router only treats a `route.ts` file as one).
 * requireProviderTenant() rides on getCurrentTenantId(), whose stale-JWT /
 * disabled-tenant fallbacks silently PROMOTE to the default tenant (known
 * fail-open, fix pending elsewhere). This brand-new sensitive write surface
 * must not inherit that, hence the mandatory guard-fail-open test below.
 *
 * mapCreateVdcError is kept REAL (not mocked) so the 400/409 status mapping
 * contract for the storage-policy error messages is pinned end to end.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'
import { callRoute } from '@/__tests__/setup/route-test'

const {
  requireProviderTenantMock,
  checkPermissionMock,
  getServerSessionMock,
  listStoragePoliciesMock,
  createStoragePolicyMock,
  updateStoragePolicyMock,
  deleteStoragePolicyMock,
  normalizeStoragePolicyInputMock,
  validateStoragePolicyInputMock,
  assertPolicyStorageValidMock,
  clearScopeCacheForPolicyMock,
  getConnectionByIdMock,
  auditMock,
  findUniqueMock,
} = vi.hoisted(() => ({
  requireProviderTenantMock: vi.fn(),
  checkPermissionMock: vi.fn(),
  getServerSessionMock: vi.fn(),
  listStoragePoliciesMock: vi.fn(),
  createStoragePolicyMock: vi.fn(),
  updateStoragePolicyMock: vi.fn(),
  deleteStoragePolicyMock: vi.fn(),
  normalizeStoragePolicyInputMock: vi.fn(),
  validateStoragePolicyInputMock: vi.fn(),
  assertPolicyStorageValidMock: vi.fn(),
  clearScopeCacheForPolicyMock: vi.fn(),
  getConnectionByIdMock: vi.fn(),
  auditMock: vi.fn(),
  findUniqueMock: vi.fn(),
}))

vi.mock('@/lib/tenant', () => ({
  requireProviderTenant: (...a: unknown[]) => requireProviderTenantMock(...a),
  DEFAULT_TENANT_ID: 'default',
}))

vi.mock('@/lib/rbac', () => ({
  checkPermission: (...a: unknown[]) => checkPermissionMock(...a),
  PERMISSIONS: { ADMIN_SETTINGS: 'admin.settings' },
}))

vi.mock('@/lib/vdc/storagePolicies', () => ({
  listStoragePolicies: (...a: unknown[]) => listStoragePoliciesMock(...a),
  createStoragePolicy: (...a: unknown[]) => createStoragePolicyMock(...a),
  updateStoragePolicy: (...a: unknown[]) => updateStoragePolicyMock(...a),
  deleteStoragePolicy: (...a: unknown[]) => deleteStoragePolicyMock(...a),
  normalizeStoragePolicyInput: (...a: unknown[]) => normalizeStoragePolicyInputMock(...a),
  validateStoragePolicyInput: (...a: unknown[]) => validateStoragePolicyInputMock(...a),
  assertPolicyStorageValid: (...a: unknown[]) => assertPolicyStorageValidMock(...a),
  clearScopeCacheForPolicy: (...a: unknown[]) => clearScopeCacheForPolicyMock(...a),
}))

vi.mock('@/lib/connections/getConnection', () => ({
  getConnectionById: (...a: unknown[]) => getConnectionByIdMock(...a),
}))

vi.mock('@/lib/audit', () => ({ audit: (...a: unknown[]) => auditMock(...a) }))

vi.mock('next-auth', () => ({
  getServerSession: (...a: unknown[]) => getServerSessionMock(...a),
}))

vi.mock('@/lib/auth/config', () => ({ authOptions: {} }))

vi.mock('@/lib/db/prisma', () => ({
  prisma: { storagePolicy: { findUnique: (...a: unknown[]) => findUniqueMock(...a) } },
}))

import { GET, POST } from './route'
import { PUT, DELETE } from './[policyId]/route'

const CONN_ID = 'conn-1'
const POLICY_ID = 'policy-1'

const VALID_BODY = {
  name: 'Gold NVMe',
  storageId: 'nvme-pool',
  iopsRd: 5000,
  iopsWr: 5000,
}

const POLICY_ROW = {
  id: POLICY_ID,
  connectionId: CONN_ID,
  name: 'Gold NVMe',
  storageId: 'nvme-pool',
}

beforeEach(() => {
  vi.clearAllMocks()
  requireProviderTenantMock.mockResolvedValue(null)
  checkPermissionMock.mockResolvedValue(null)
  getServerSessionMock.mockResolvedValue({ user: { id: 'admin-1', tenantId: 'default' } })
  listStoragePoliciesMock.mockResolvedValue([{ id: POLICY_ID, vdcCount: 2 }])
  createStoragePolicyMock.mockResolvedValue(POLICY_ROW)
  updateStoragePolicyMock.mockResolvedValue(POLICY_ROW)
  deleteStoragePolicyMock.mockResolvedValue(undefined)
  // Mirrors the real normalizeStoragePolicyInput transform (kept simple
  // here; the transform itself is pinned by storagePolicies.test.ts).
  normalizeStoragePolicyInputMock.mockImplementation((body: any) => ({
    name: String(body?.name ?? '').trim(),
    description: typeof body?.description === 'string' ? body.description : null,
    storageId: String(body?.storageId ?? '').trim(),
    iopsRd: body?.iopsRd ?? null,
    iopsWr: body?.iopsWr ?? null,
    mbpsRd: body?.mbpsRd ?? null,
    mbpsWr: body?.mbpsWr ?? null,
  }))
  validateStoragePolicyInputMock.mockReturnValue(undefined)
  assertPolicyStorageValidMock.mockResolvedValue(undefined)
  clearScopeCacheForPolicyMock.mockResolvedValue(undefined)
  getConnectionByIdMock.mockResolvedValue({ id: CONN_ID })
  findUniqueMock.mockResolvedValue({ connectionId: CONN_ID, name: POLICY_ROW.name })
})

describe('provider guard (shared by both route files)', () => {
  it('403s when requireProviderTenant fails open (null) but the raw session tenant is not default', async () => {
    // The documented fail-open: getCurrentTenantId can silently promote a
    // stale/disabled-tenant session to the default tenant, so
    // requireProviderTenant() alone can pass (return null) for a caller
    // whose real session tenant is NOT the provider. The route must still
    // 403 by checking the raw session tenant directly. This is THE
    // guard-fail-open test required by spec §8.1.
    requireProviderTenantMock.mockResolvedValue(null)
    getServerSessionMock.mockResolvedValue({ user: { id: 'u1', tenantId: 'tenant-acme' } })

    const res = await callRoute(GET as Parameters<typeof callRoute>[0], { params: { id: CONN_ID } })
    expect(res.status).toBe(403)
    expect(listStoragePoliciesMock).not.toHaveBeenCalled()
    expect(checkPermissionMock).not.toHaveBeenCalled()
  })

  it('403s when requireProviderTenant itself denies, without touching the session', async () => {
    requireProviderTenantMock.mockResolvedValue(NextResponse.json({ error: 'forbidden' }, { status: 403 }))

    const res = await callRoute(GET as Parameters<typeof callRoute>[0], { params: { id: CONN_ID } })
    expect(res.status).toBe(403)
    expect(getServerSessionMock).not.toHaveBeenCalled()
  })

  it('returns the deny response when checkPermission refuses', async () => {
    checkPermissionMock.mockResolvedValue(NextResponse.json({ error: 'nope' }, { status: 403 }))

    const res = await callRoute(GET as Parameters<typeof callRoute>[0], { params: { id: CONN_ID } })
    expect(res.status).toBe(403)
    expect(listStoragePoliciesMock).not.toHaveBeenCalled()
  })
})

describe('GET /api/v1/admin/connections/{id}/storage-policies', () => {
  it('lists policies for the given connection (with vdcCount passed through)', async () => {
    const res = await callRoute(GET as Parameters<typeof callRoute>[0], { params: { id: CONN_ID } })

    expect(res.status).toBe(200)
    expect(listStoragePoliciesMock).toHaveBeenCalledWith(CONN_ID)
    expect(await res.json()).toEqual({ data: [{ id: POLICY_ID, vdcCount: 2 }] })
  })
})

describe('POST /api/v1/admin/connections/{id}/storage-policies', () => {
  it('validates, PVE-probes the storage, creates, audits, returns 201', async () => {
    const res = await callRoute(POST as Parameters<typeof callRoute>[0], {
      method: 'POST',
      params: { id: CONN_ID },
      body: VALID_BODY,
    })

    expect(res.status).toBe(201)
    expect(validateStoragePolicyInputMock).toHaveBeenCalled()
    expect(assertPolicyStorageValidMock).toHaveBeenCalledWith({ id: CONN_ID }, 'nvme-pool')
    expect(createStoragePolicyMock).toHaveBeenCalledWith(
      CONN_ID,
      expect.objectContaining({ name: 'Gold NVMe', storageId: 'nvme-pool' }),
    )
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'create', category: 'settings', resourceType: 'storage-policy' }),
    )
    expect((await res.json()).data).toEqual(POLICY_ROW)
  })

  it('400s a negative iopsRd via the "Storage policy ..." message contract', async () => {
    validateStoragePolicyInputMock.mockImplementation(() => {
      throw new Error('Storage policy iopsRd must be a positive integer or null')
    })

    const res = await callRoute(POST as Parameters<typeof callRoute>[0], {
      method: 'POST',
      params: { id: CONN_ID },
      body: { ...VALID_BODY, iopsRd: -5 },
    })

    expect(res.status).toBe(400)
    expect((await res.json()).error).toMatch(/^Storage policy/)
    expect(createStoragePolicyMock).not.toHaveBeenCalled()
  })

  it('maps an invalid-storage rejection from assertPolicyStorageValid to 400', async () => {
    assertPolicyStorageValidMock.mockRejectedValue(
      new Error('Storage policy storage "nvme-pool" not found on this connection'),
    )

    const res = await callRoute(POST as Parameters<typeof callRoute>[0], {
      method: 'POST',
      params: { id: CONN_ID },
      body: VALID_BODY,
    })

    expect(res.status).toBe(400)
    expect(createStoragePolicyMock).not.toHaveBeenCalled()
  })

  it('maps a uniqueness rejection from createStoragePolicy to 409', async () => {
    createStoragePolicyMock.mockRejectedValue(
      new Error('A storage policy with this name or storage already exists on this connection'),
    )

    const res = await callRoute(POST as Parameters<typeof callRoute>[0], {
      method: 'POST',
      params: { id: CONN_ID },
      body: VALID_BODY,
    })

    expect(res.status).toBe(409)
    expect(auditMock).not.toHaveBeenCalled()
  })
})

describe('PUT /api/v1/admin/connections/{id}/storage-policies/{policyId}', () => {
  it('404s an unknown policyId without calling updateStoragePolicy', async () => {
    findUniqueMock.mockResolvedValue(null)

    const res = await callRoute(PUT as Parameters<typeof callRoute>[0], {
      method: 'PUT',
      params: { id: CONN_ID, policyId: 'missing' },
      body: VALID_BODY,
    })

    expect(res.status).toBe(404)
    expect(updateStoragePolicyMock).not.toHaveBeenCalled()
  })

  it('404s a policyId owned by another connection (closes the forged-URL cross-connection edit)', async () => {
    findUniqueMock.mockResolvedValue({ connectionId: 'other-conn', name: 'Gold NVMe' })

    const res = await callRoute(PUT as Parameters<typeof callRoute>[0], {
      method: 'PUT',
      params: { id: CONN_ID, policyId: POLICY_ID },
      body: VALID_BODY,
    })

    expect(res.status).toBe(404)
    expect(updateStoragePolicyMock).not.toHaveBeenCalled()
  })

  it('200s, updates, clears the scope cache, audits', async () => {
    const res = await callRoute(PUT as Parameters<typeof callRoute>[0], {
      method: 'PUT',
      params: { id: CONN_ID, policyId: POLICY_ID },
      body: VALID_BODY,
    })

    expect(res.status).toBe(200)
    expect(updateStoragePolicyMock).toHaveBeenCalledWith(POLICY_ID, expect.objectContaining({ name: 'Gold NVMe' }))
    expect(clearScopeCacheForPolicyMock).toHaveBeenCalledWith(POLICY_ID)
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'update', category: 'settings', resourceType: 'storage-policy' }),
    )
    expect((await res.json()).data).toEqual(POLICY_ROW)
  })

  it('409s a storage-change-while-assigned rejection from updateStoragePolicy (Finding I3)', async () => {
    updateStoragePolicyMock.mockRejectedValue(
      new Error('Storage policy storage cannot be changed while assigned to vDCs: "Acme"'),
    )

    const res = await callRoute(PUT as Parameters<typeof callRoute>[0], {
      method: 'PUT',
      params: { id: CONN_ID, policyId: POLICY_ID },
      body: { ...VALID_BODY, storageId: 'other-storage' },
    })

    expect(res.status).toBe(409)
    expect(clearScopeCacheForPolicyMock).not.toHaveBeenCalled()
    expect(auditMock).not.toHaveBeenCalled()
  })
})

describe('DELETE /api/v1/admin/connections/{id}/storage-policies/{policyId}', () => {
  it('404s an unknown policyId', async () => {
    findUniqueMock.mockResolvedValue(null)

    const res = await callRoute(DELETE as Parameters<typeof callRoute>[0], {
      method: 'DELETE',
      params: { id: CONN_ID, policyId: 'missing' },
    })

    expect(res.status).toBe(404)
    expect(deleteStoragePolicyMock).not.toHaveBeenCalled()
  })

  it('404s a policyId owned by another connection (closes the forged-URL cross-connection delete)', async () => {
    findUniqueMock.mockResolvedValue({ connectionId: 'other-conn', name: 'Gold NVMe' })

    const res = await callRoute(DELETE as Parameters<typeof callRoute>[0], {
      method: 'DELETE',
      params: { id: CONN_ID, policyId: POLICY_ID },
    })

    expect(res.status).toBe(404)
    expect(deleteStoragePolicyMock).not.toHaveBeenCalled()
  })

  it('maps an in-use rejection to 409', async () => {
    deleteStoragePolicyMock.mockRejectedValue(new Error('Storage policy is in use by vDC "prod-acme"'))

    const res = await callRoute(DELETE as Parameters<typeof callRoute>[0], {
      method: 'DELETE',
      params: { id: CONN_ID, policyId: POLICY_ID },
    })

    expect(res.status).toBe(409)
    expect(auditMock).not.toHaveBeenCalled()
  })

  it('deletes, audits, returns success', async () => {
    const res = await callRoute(DELETE as Parameters<typeof callRoute>[0], {
      method: 'DELETE',
      params: { id: CONN_ID, policyId: POLICY_ID },
    })

    expect(res.status).toBe(200)
    expect(deleteStoragePolicyMock).toHaveBeenCalledWith(POLICY_ID)
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'delete', category: 'settings', resourceType: 'storage-policy' }),
    )
    expect(await res.json()).toEqual({ success: true })
  })
})
