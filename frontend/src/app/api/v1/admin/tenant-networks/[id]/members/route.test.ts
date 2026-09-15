/**
 * POST + DELETE /api/v1/admin/tenant-networks/[id]/members (#901): a vDC joins
 * or leaves a stretched tenant network. Error mapping kept REAL.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

import { callRoute } from '@/__tests__/setup/route-test'

const { requireProviderTenantMock, checkPermissionMock, addMock, removeMock, getMock, auditMock } = vi.hoisted(() => ({
  requireProviderTenantMock: vi.fn(),
  checkPermissionMock: vi.fn(),
  addMock: vi.fn(),
  removeMock: vi.fn(),
  getMock: vi.fn(),
  auditMock: vi.fn(),
}))

vi.mock('@/lib/tenant', () => ({ requireProviderTenant: (...a: unknown[]) => requireProviderTenantMock(...a) }))
vi.mock('@/lib/rbac', () => ({
  checkPermission: (...a: unknown[]) => checkPermissionMock(...a),
  PERMISSIONS: { ADMIN_SETTINGS: 'admin.settings' },
}))
vi.mock('@/lib/audit', () => ({ audit: (...a: unknown[]) => auditMock(...a) }))
vi.mock('@/lib/vdc/tenantNetworkMembers', () => ({
  addMember: (...a: unknown[]) => addMock(...a),
  removeMember: (...a: unknown[]) => removeMock(...a),
}))
vi.mock('@/lib/vdc/tenantNetworks', () => ({ getTenantNetwork: (...a: unknown[]) => getMock(...a) }))

import { DELETE, POST } from './route'

const NETWORK = { id: 'n1', tenantId: 't1', name: 'backbone', vni: 10002, members: [{ vdcId: 'v1' }] }
const SYNC = [{ vdcId: 'v1', vdcName: 'MSP-vDC', connectionId: 'c1', zoneName: 'z', changed: true }]

// DELETE reads req.nextUrl (NextRequest); callRoute builds a plain Request.
const nextReq = (url: string) => ({ nextUrl: new URL(url) }) as any
const ctx = (id?: string) => ({ params: Promise.resolve(id ? { id } : {}) })

beforeEach(() => {
  vi.clearAllMocks()
  requireProviderTenantMock.mockResolvedValue(null)
  checkPermissionMock.mockResolvedValue(null)
  addMock.mockResolvedValue({ vdcId: 'v1', vnetId: 'vn1', pveName: 'v32cf5fc', zoneSync: SYNC })
  removeMock.mockResolvedValue({ zoneSync: SYNC })
  getMock.mockResolvedValue(NETWORK)
})

describe('POST .../members', () => {
  it('is gated and needs an id and a vdcId', async () => {
    requireProviderTenantMock.mockResolvedValueOnce(NextResponse.json({ error: 'forbidden' }, { status: 403 }))
    expect((await callRoute(POST as any, { method: 'POST', params: { id: 'n1' }, body: { vdcId: 'v1' } })).status).toBe(403)
    expect((await callRoute(POST as any, { method: 'POST', params: {}, body: { vdcId: 'v1' } })).status).toBe(400)
    expect((await callRoute(POST as any, { method: 'POST', params: { id: 'n1' }, body: {} })).status).toBe(400)
    expect(addMock).not.toHaveBeenCalled()
  })

  it('adds the member, audits with the zone sync, and returns the result with the network', async () => {
    const res = await callRoute(POST as any, { method: 'POST', params: { id: 'n1' }, body: { vdcId: 'v1' } })
    expect(res.status).toBe(201)
    expect(addMock).toHaveBeenCalledWith('n1', 'v1')
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
      details: expect.objectContaining({ operation: 'add-member', vdcId: 'v1', pveName: 'v32cf5fc', zoneSync: SYNC }),
    }))
    expect(await res.json()).toEqual({ data: { vdcId: 'v1', vnetId: 'vn1', pveName: 'v32cf5fc', zoneSync: SYNC, network: NETWORK } })
  })

  it('maps the refusals: 409 already a member, 400 no zone, 502 Proxmox refused, 404 unknown vDC', async () => {
    const cases: Array<[string, number]> = [
      ['Tenant network: vDC "x" already carries "backbone".', 409],
      ['Tenant network: vDC "x" has no VXLAN zone, a VLAN-only vDC cannot carry a stretched network.', 400],
      ['Failed to create SDN VNet "backbone": 400 bad request', 502],
      ['vDC not found: v9', 404],
    ]
    for (const [message, status] of cases) {
      addMock.mockRejectedValueOnce(new Error(message))
      expect((await callRoute(POST as any, { method: 'POST', params: { id: 'n1' }, body: { vdcId: 'v1' } })).status).toBe(status)
    }
    expect(auditMock).not.toHaveBeenCalled()
  })
})

describe('DELETE .../members?vdcId=', () => {
  it('needs the vdcId query parameter', async () => {
    const res = await DELETE(nextReq('http://test/api/v1/admin/tenant-networks/n1/members'), ctx('n1'))
    expect(res.status).toBe(400)
    expect(removeMock).not.toHaveBeenCalled()
  })

  it('removes the member, audits, and returns the zone sync with the network', async () => {
    const res = await DELETE(nextReq('http://test/api/v1/admin/tenant-networks/n1/members?vdcId=v1'), ctx('n1'))
    expect(res.status).toBe(200)
    expect(removeMock).toHaveBeenCalledWith('n1', 'v1')
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ details: { operation: 'remove-member', vdcId: 'v1', zoneSync: SYNC } }))
    expect(await res.json()).toEqual({ data: { zoneSync: SYNC, network: NETWORK } })
  })

  it('answers 409 while guest NICs still use the local VNet', async () => {
    removeMock.mockRejectedValueOnce(new Error('Tenant network: 2 guest NIC(s) still use "backbone" on vDC "MSP-vDC". Detach them first.'))
    const res = await DELETE(nextReq('http://test/api/v1/admin/tenant-networks/n1/members?vdcId=v1'), ctx('n1'))
    expect(res.status).toBe(409)
  })
})
