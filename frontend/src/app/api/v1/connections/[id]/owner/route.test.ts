import { beforeEach, describe, expect, it, vi } from 'vitest'

import { callRoute, readJson } from '../../../../../../__tests__/setup/route-test'

const {
  checkPermissionMock,
  requireProviderTenantMock,
  connectionFindUniqueMock,
  tenantFindUniqueMock,
  invalidateConnectionCacheMock,
  auditMock,
  assignConnectionToMspTenantMock,
  releaseConnectionToProviderPoolMock,
} = vi.hoisted(() => ({
  checkPermissionMock: vi.fn(),
  requireProviderTenantMock: vi.fn(),
  connectionFindUniqueMock: vi.fn(),
  tenantFindUniqueMock: vi.fn(),
  invalidateConnectionCacheMock: vi.fn(),
  auditMock: vi.fn(),
  assignConnectionToMspTenantMock: vi.fn(),
  releaseConnectionToProviderPoolMock: vi.fn(),
}))

vi.mock('@/lib/rbac', () => ({
  checkPermission: checkPermissionMock,
  PERMISSIONS: { CONNECTION_MANAGE: 'connection.manage' },
}))

vi.mock('@/lib/tenant', () => ({
  requireProviderTenant: requireProviderTenantMock,
}))

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    connection: { findUnique: connectionFindUniqueMock },
    tenant: { findUnique: tenantFindUniqueMock },
  },
}))

vi.mock('@/lib/connections/getConnection', () => ({
  invalidateConnectionCache: invalidateConnectionCacheMock,
}))

vi.mock('@/lib/audit', () => ({
  audit: auditMock,
}))

vi.mock('@/lib/connections/assignment', () => ({
  assignConnectionToMspTenant: assignConnectionToMspTenantMock,
  releaseConnectionToProviderPool: releaseConnectionToProviderPoolMock,
}))

const defaultConn = { id: 'conn-1', name: 'Lab PVE', type: 'pve', tenantId: 'default' }
const mspTenant = { operatingModel: 'msp', enabled: true }

beforeEach(() => {
  checkPermissionMock.mockReset().mockResolvedValue(null)
  requireProviderTenantMock.mockReset().mockResolvedValue(null)
  connectionFindUniqueMock.mockReset().mockResolvedValue(defaultConn)
  tenantFindUniqueMock.mockReset().mockResolvedValue(mspTenant)
  invalidateConnectionCacheMock.mockReset()
  auditMock.mockReset().mockResolvedValue(undefined)
  assignConnectionToMspTenantMock.mockReset().mockResolvedValue(undefined)
  releaseConnectionToProviderPoolMock.mockReset().mockResolvedValue(undefined)
})

async function importPUT() {
  const mod = await import('./route')
  return mod.PUT as Parameters<typeof callRoute>[0]
}

describe('PUT /api/v1/connections/[id]/owner - guards', () => {
  it('returns the denied response when checkPermission rejects', async () => {
    const denied = new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 })
    checkPermissionMock.mockResolvedValueOnce(denied)

    const PUT = await importPUT()
    const res = await callRoute(PUT, { method: 'PUT', params: { id: 'conn-1' }, body: { tenantId: 'msp-1' } })

    expect(res.status).toBe(403)
    expect(assignConnectionToMspTenantMock).not.toHaveBeenCalled()
  })

  it('returns the denied response when requireProviderTenant rejects', async () => {
    const denied = new Response(JSON.stringify({ error: 'provider only' }), { status: 403 })
    requireProviderTenantMock.mockResolvedValueOnce(denied)

    const PUT = await importPUT()
    const res = await callRoute(PUT, { method: 'PUT', params: { id: 'conn-1' }, body: { tenantId: 'msp-1' } })

    expect(res.status).toBe(403)
    expect(assignConnectionToMspTenantMock).not.toHaveBeenCalled()
  })

  it('returns 400 when tenantId is missing', async () => {
    const PUT = await importPUT()
    const res = await callRoute(PUT, { method: 'PUT', params: { id: 'conn-1' }, body: {} })

    expect(res.status).toBe(400)
    const json = await readJson<any>(res)
    expect(json.error).toMatch(/tenantId/i)
  })

  it('returns 400 when body is not valid JSON', async () => {
    const PUT = await importPUT()
    const res = await callRoute(PUT, {
      method: 'PUT',
      params: { id: 'conn-1' },
      body: 'not-json',
      headers: { 'content-type': 'application/json' },
    })

    expect(res.status).toBe(400)
  })

  it('returns 404 when connection is not found', async () => {
    connectionFindUniqueMock.mockResolvedValueOnce(null)

    const PUT = await importPUT()
    const res = await callRoute(PUT, { method: 'PUT', params: { id: 'conn-x' }, body: { tenantId: 'msp-1' } })

    expect(res.status).toBe(404)
  })

  it('returns 400 when target tenant is not an MSP tenant', async () => {
    tenantFindUniqueMock.mockResolvedValueOnce({ operatingModel: 'iaas', enabled: true })

    const PUT = await importPUT()
    const res = await callRoute(PUT, { method: 'PUT', params: { id: 'conn-1' }, body: { tenantId: 'iaas-1' } })

    expect(res.status).toBe(400)
    const json = await readJson<any>(res)
    expect(json.error).toMatch(/msp/i)
  })

  it('returns 404 when target tenant is disabled', async () => {
    tenantFindUniqueMock.mockResolvedValueOnce({ operatingModel: 'msp', enabled: false })

    const PUT = await importPUT()
    const res = await callRoute(PUT, { method: 'PUT', params: { id: 'conn-1' }, body: { tenantId: 'msp-1' } })

    expect(res.status).toBe(404)
  })
})

describe('PUT /api/v1/connections/[id]/owner - assignment', () => {
  it('calls assignConnectionToMspTenant when tenantId is an MSP tenant', async () => {
    const PUT = await importPUT()
    const res = await callRoute(PUT, { method: 'PUT', params: { id: 'conn-1' }, body: { tenantId: 'msp-1' } })

    expect(res.status).toBe(200)
    expect(assignConnectionToMspTenantMock).toHaveBeenCalledWith('conn-1', 'msp-1')
    expect(releaseConnectionToProviderPoolMock).not.toHaveBeenCalled()
    const json = await readJson<any>(res)
    expect(json).toMatchObject({ success: true, connectionId: 'conn-1', tenantId: 'msp-1' })
  })

  it('calls releaseConnectionToProviderPool when tenantId is default', async () => {
    const PUT = await importPUT()
    const res = await callRoute(PUT, { method: 'PUT', params: { id: 'conn-1' }, body: { tenantId: 'default' } })

    expect(res.status).toBe(200)
    expect(releaseConnectionToProviderPoolMock).toHaveBeenCalledWith('conn-1')
    expect(assignConnectionToMspTenantMock).not.toHaveBeenCalled()
    const json = await readJson<any>(res)
    expect(json).toMatchObject({ success: true, connectionId: 'conn-1', tenantId: 'default' })
  })

  it('invalidates the connection cache and records an audit entry on success', async () => {
    const PUT = await importPUT()
    await callRoute(PUT, { method: 'PUT', params: { id: 'conn-1' }, body: { tenantId: 'msp-1' } })

    expect(invalidateConnectionCacheMock).toHaveBeenCalledWith('conn-1')
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'update',
        category: 'connections',
        resourceId: 'conn-1',
        details: expect.objectContaining({ to: 'msp-1' }),
        status: 'success',
      }),
    )
  })

  it('returns 409 when the helper throws a RESTRICT / state-change error', async () => {
    assignConnectionToMspTenantMock.mockRejectedValueOnce(
      new Error('update or delete on table "provider_connections" violates foreign key constraint'),
    )

    const PUT = await importPUT()
    const res = await callRoute(PUT, { method: 'PUT', params: { id: 'conn-1' }, body: { tenantId: 'msp-1' } })

    expect(res.status).toBe(409)
    const json = await readJson<any>(res)
    expect(json.error).toMatch(/foreign key/i)
  })

  it('returns 409 when the helper throws a state changed error', async () => {
    assignConnectionToMspTenantMock.mockRejectedValueOnce(
      new Error('Connection conn-1 state changed mid-transaction'),
    )

    const PUT = await importPUT()
    const res = await callRoute(PUT, { method: 'PUT', params: { id: 'conn-1' }, body: { tenantId: 'msp-1' } })

    expect(res.status).toBe(409)
  })

  it('returns 409 for a Prisma conflict code even when the message does not match the text classifier', async () => {
    // Real Prisma FK/predicated-update failures surface as P2003/P2025 with a
    // generic message; the route must classify them as conflicts by code.
    assignConnectionToMspTenantMock.mockRejectedValueOnce(
      Object.assign(new Error('Record to update not found.'), { code: 'P2025' }),
    )

    const PUT = await importPUT()
    const res = await callRoute(PUT, { method: 'PUT', params: { id: 'conn-1' }, body: { tenantId: 'msp-1' } })

    expect(res.status).toBe(409)
  })
})
