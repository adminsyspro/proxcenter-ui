/**
 * POST /api/v1/admin/tenant-networks/[id]/reachability (#901): every node of
 * each member pings the other members' peers over SSH. Read-only, no audit.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

import { callRoute } from '@/__tests__/setup/route-test'

const { requireProviderTenantMock, checkPermissionMock, testMock } = vi.hoisted(() => ({
  requireProviderTenantMock: vi.fn(),
  checkPermissionMock: vi.fn(),
  testMock: vi.fn(),
}))

vi.mock('@/lib/tenant', () => ({ requireProviderTenant: (...a: unknown[]) => requireProviderTenantMock(...a) }))
vi.mock('@/lib/rbac', () => ({
  checkPermission: (...a: unknown[]) => checkPermissionMock(...a),
  PERMISSIONS: { ADMIN_SETTINGS: 'admin.settings' },
}))
vi.mock('@/lib/vdc/tenantNetworkReachability', () => ({ testNetworkReachability: (...a: unknown[]) => testMock(...a) }))

import { POST } from './route'

const RESULTS = [{ vdcId: 'v1', vdcName: 'MSP-vDC', connectionId: 'c1', connectionName: 'PVE-PROD', node: 'pve1', peer: '203.0.113.21', state: 'reachable' }]

beforeEach(() => {
  vi.clearAllMocks()
  requireProviderTenantMock.mockResolvedValue(null)
  checkPermissionMock.mockResolvedValue(null)
  testMock.mockResolvedValue(RESULTS)
})

describe('POST .../reachability', () => {
  it('is gated and needs an id', async () => {
    expect((await callRoute(POST as any, { method: 'POST', params: {} })).status).toBe(400)
    requireProviderTenantMock.mockResolvedValueOnce(NextResponse.json({ error: 'forbidden' }, { status: 403 }))
    expect((await callRoute(POST as any, { method: 'POST', params: { id: 'n1' } })).status).toBe(403)
    checkPermissionMock.mockResolvedValueOnce(NextResponse.json({ error: 'denied' }, { status: 403 }))
    expect((await callRoute(POST as any, { method: 'POST', params: { id: 'n1' } })).status).toBe(403)
    expect(testMock).not.toHaveBeenCalled()
  })

  it('returns the per-node, per-peer results', async () => {
    const res = await callRoute(POST as any, { method: 'POST', params: { id: 'n1' } })
    expect(res.status).toBe(200)
    expect(testMock).toHaveBeenCalledWith('n1')
    expect(await res.json()).toEqual({ data: { results: RESULTS } })
  })

  it('maps a network with fewer than two members to 400 and an unknown one to 404', async () => {
    testMock.mockRejectedValueOnce(new Error('Tenant network: "backbone" needs at least two member vDCs to test reachability.'))
    expect((await callRoute(POST as any, { method: 'POST', params: { id: 'n1' } })).status).toBe(400)
    testMock.mockRejectedValueOnce(new Error('Tenant network: not found: nope'))
    expect((await callRoute(POST as any, { method: 'POST', params: { id: 'nope' } })).status).toBe(404)
  })
})
