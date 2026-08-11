/**
 * GET /api/v1/admin/connections — provider-only fleet listing. Each row is
 * flagged with inProviderPool so the vDC cluster picker can exclude
 * MSP-owned connections (IaaS/MSP exclusivity).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { callRoute } from '@/__tests__/setup/route-test'

const { requireProviderTenantMock, checkPermissionMock, connFindManyMock, poolFindManyMock } = vi.hoisted(() => ({
  requireProviderTenantMock: vi.fn(),
  checkPermissionMock: vi.fn(),
  connFindManyMock: vi.fn(),
  poolFindManyMock: vi.fn(),
}))

vi.mock('@/lib/tenant', () => ({
  requireProviderTenant: (...a: unknown[]) => requireProviderTenantMock(...a),
}))

vi.mock('@/lib/rbac', () => ({
  checkPermission: (...a: unknown[]) => checkPermissionMock(...a),
  PERMISSIONS: { ADMIN_SETTINGS: 'admin.settings' },
}))

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    connection: { findMany: (...a: unknown[]) => connFindManyMock(...a) },
    providerConnection: { findMany: (...a: unknown[]) => poolFindManyMock(...a) },
  },
}))

import { GET } from './route'
import { NextResponse } from 'next/server'

beforeEach(() => {
  vi.clearAllMocks()
  requireProviderTenantMock.mockResolvedValue(null)
  checkPermissionMock.mockResolvedValue(null)
  connFindManyMock.mockResolvedValue([
    { id: 'c1', name: 'cluster-1', type: 'pve' },
    { id: 'c2', name: 'msp-cluster', type: 'pve' },
  ])
  poolFindManyMock.mockResolvedValue([{ connectionId: 'c1' }])
})

describe('GET /api/v1/admin/connections', () => {
  it('is provider-gated', async () => {
    requireProviderTenantMock.mockResolvedValue(NextResponse.json({ error: 'forbidden' }, { status: 403 }))

    const res = await callRoute(GET as Parameters<typeof callRoute>[0], { method: 'GET' })
    expect(res.status).toBe(403)
    expect(connFindManyMock).not.toHaveBeenCalled()
  })

  it('flags provider-pool membership on each connection', async () => {
    const res = await callRoute(GET as Parameters<typeof callRoute>[0], { method: 'GET' })
    expect(res.status).toBe(200)

    const body = await res.json()
    expect(body.data).toEqual([
      expect.objectContaining({ id: 'c1', inProviderPool: true }),
      expect.objectContaining({ id: 'c2', inProviderPool: false }),
    ])
  })

  it('forwards the type filter to the query', async () => {
    const res = await callRoute(GET as Parameters<typeof callRoute>[0], {
      method: 'GET',
      searchParams: { type: 'pbs' },
    })
    expect(res.status).toBe(200)
    expect(connFindManyMock).toHaveBeenCalledWith(expect.objectContaining({ where: { type: 'pbs' } }))
  })
})
