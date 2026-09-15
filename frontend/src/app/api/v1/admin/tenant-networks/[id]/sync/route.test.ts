/**
 * POST /api/v1/admin/tenant-networks/[id]/sync (#901): re-exchange the zone
 * peers of every member. Error mapping kept REAL.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

import { callRoute } from '@/__tests__/setup/route-test'

const { requireProviderTenantMock, checkPermissionMock, syncMock, getMock, auditMock } = vi.hoisted(() => ({
  requireProviderTenantMock: vi.fn(),
  checkPermissionMock: vi.fn(),
  syncMock: vi.fn(),
  getMock: vi.fn(),
  auditMock: vi.fn(),
}))

vi.mock('@/lib/tenant', () => ({ requireProviderTenant: (...a: unknown[]) => requireProviderTenantMock(...a) }))
vi.mock('@/lib/rbac', () => ({
  checkPermission: (...a: unknown[]) => checkPermissionMock(...a),
  PERMISSIONS: { ADMIN_SETTINGS: 'admin.settings' },
}))
vi.mock('@/lib/audit', () => ({ audit: (...a: unknown[]) => auditMock(...a) }))
vi.mock('@/lib/vdc/tenantNetworkMembers', () => ({ syncNetworkZones: (...a: unknown[]) => syncMock(...a) }))
vi.mock('@/lib/vdc/tenantNetworks', () => ({ getTenantNetwork: (...a: unknown[]) => getMock(...a) }))

import { POST } from './route'

const NETWORK = { id: 'n1', tenantId: 't1', name: 'backbone', vni: 10002, members: [] }
const SYNC = [{ vdcId: 'v1', vdcName: 'MSP-vDC', connectionId: 'c1', zoneName: 'z', changed: false }]

beforeEach(() => {
  vi.clearAllMocks()
  requireProviderTenantMock.mockResolvedValue(null)
  checkPermissionMock.mockResolvedValue(null)
  syncMock.mockResolvedValue(SYNC)
  getMock.mockResolvedValue(NETWORK)
})

describe('POST .../sync', () => {
  it('is gated and needs an id', async () => {
    expect((await callRoute(POST as any, { method: 'POST', params: {} })).status).toBe(400)
    requireProviderTenantMock.mockResolvedValueOnce(NextResponse.json({ error: 'forbidden' }, { status: 403 }))
    expect((await callRoute(POST as any, { method: 'POST', params: { id: 'n1' } })).status).toBe(403)
    checkPermissionMock.mockResolvedValueOnce(NextResponse.json({ error: 'denied' }, { status: 403 }))
    expect((await callRoute(POST as any, { method: 'POST', params: { id: 'n1' } })).status).toBe(403)
    expect(syncMock).not.toHaveBeenCalled()
  })

  it('syncs every member zone, audits, and returns the results with the network', async () => {
    const res = await callRoute(POST as any, { method: 'POST', params: { id: 'n1' } })
    expect(res.status).toBe(200)
    expect(syncMock).toHaveBeenCalledWith('n1')
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ details: { operation: 'zone-sync', zoneSync: SYNC } }))
    expect(await res.json()).toEqual({ data: { zoneSync: SYNC, network: NETWORK } })
  })

  it('answers 404 for an unknown network', async () => {
    getMock.mockRejectedValueOnce(new Error('Tenant network: not found: nope'))
    expect((await callRoute(POST as any, { method: 'POST', params: { id: 'nope' } })).status).toBe(404)
    expect(syncMock).not.toHaveBeenCalled()
  })
})
