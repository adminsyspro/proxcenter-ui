/**
 * GET + PUT + DELETE /api/v1/admin/tenant-networks/[id] (#901). The error
 * mapping is kept REAL: not found is 404, a refusal 409, bad input 400.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

import { callRoute } from '@/__tests__/setup/route-test'

const { requireProviderTenantMock, checkPermissionMock, getMock, updateMock, deleteMock, auditMock } = vi.hoisted(() => ({
  requireProviderTenantMock: vi.fn(),
  checkPermissionMock: vi.fn(),
  getMock: vi.fn(),
  updateMock: vi.fn(),
  deleteMock: vi.fn(),
  auditMock: vi.fn(),
}))

vi.mock('@/lib/tenant', () => ({ requireProviderTenant: (...a: unknown[]) => requireProviderTenantMock(...a) }))
vi.mock('@/lib/rbac', () => ({
  checkPermission: (...a: unknown[]) => checkPermissionMock(...a),
  PERMISSIONS: { ADMIN_SETTINGS: 'admin.settings' },
}))
vi.mock('@/lib/audit', () => ({ audit: (...a: unknown[]) => auditMock(...a) }))
vi.mock('@/lib/vdc/tenantNetworks', () => ({
  getTenantNetwork: (...a: unknown[]) => getMock(...a),
  updateTenantNetwork: (...a: unknown[]) => updateMock(...a),
  deleteTenantNetwork: (...a: unknown[]) => deleteMock(...a),
}))

import { DELETE, GET, PUT } from './route'

const NETWORK = { id: 'n1', tenantId: 't1', name: 'backbone', vni: 10002, mtu: null, members: [] }

beforeEach(() => {
  vi.clearAllMocks()
  requireProviderTenantMock.mockResolvedValue(null)
  checkPermissionMock.mockResolvedValue(null)
  getMock.mockResolvedValue(NETWORK)
  updateMock.mockResolvedValue({ ...NETWORK, name: 'spine' })
  deleteMock.mockResolvedValue(undefined)
})

describe('gate', () => {
  it('400s without an id, 403s for a non-provider tenant or a missing permission', async () => {
    expect((await callRoute(GET as any, { params: {} })).status).toBe(400)
    requireProviderTenantMock.mockResolvedValueOnce(NextResponse.json({ error: 'forbidden' }, { status: 403 }))
    expect((await callRoute(GET as any, { params: { id: 'n1' } })).status).toBe(403)
    checkPermissionMock.mockResolvedValueOnce(NextResponse.json({ error: 'denied' }, { status: 403 }))
    expect((await callRoute(GET as any, { params: { id: 'n1' } })).status).toBe(403)
    expect(getMock).not.toHaveBeenCalled()
  })
})

describe('GET', () => {
  it('returns the network, 404 when unknown', async () => {
    const res = await callRoute(GET as any, { params: { id: 'n1' } })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ data: NETWORK })
    getMock.mockRejectedValueOnce(new Error('Tenant network: not found: nope'))
    expect((await callRoute(GET as any, { params: { id: 'nope' } })).status).toBe(404)
  })
})

describe('PUT', () => {
  it('forwards name, description, MTU and DNS, audits and returns the updated network', async () => {
    const res = await callRoute(PUT as any, { method: 'PUT', params: { id: 'n1' }, body: { name: 'spine', description: 'x', mtu: 8950, subnet: { dnsServers: ['1.1.1.1'] } } })
    expect(res.status).toBe(200)
    expect(updateMock).toHaveBeenCalledWith('n1', { name: 'spine', description: 'x', mtu: 8950, subnet: { dnsServers: ['1.1.1.1'] } })
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'update', resourceType: 'tenant-network', resourceName: 'spine' }))
  })

  it('answers 409 when the MTU cannot change under members', async () => {
    updateMock.mockRejectedValueOnce(new Error('Tenant network: the MTU cannot change while 2 vDC(s) carry the network. Remove the members first.'))
    const res = await callRoute(PUT as any, { method: 'PUT', params: { id: 'n1' }, body: { mtu: 1400 } })
    expect(res.status).toBe(409)
    expect(auditMock).not.toHaveBeenCalled()
  })
})

describe('DELETE', () => {
  it('deletes an empty network and audits it', async () => {
    const res = await callRoute(DELETE as any, { method: 'DELETE', params: { id: 'n1' } })
    expect(res.status).toBe(200)
    expect(deleteMock).toHaveBeenCalledWith('n1')
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'delete', resourceName: 'backbone', details: { tenantId: 't1', vni: 10002 } }))
    expect(await res.json()).toEqual({ data: { success: true } })
  })

  it('answers 409 while vDCs still carry the network', async () => {
    deleteMock.mockRejectedValueOnce(new Error('Tenant network: "backbone" is still carried by 2 vDC(s). Remove the members first.'))
    expect((await callRoute(DELETE as any, { method: 'DELETE', params: { id: 'n1' } })).status).toBe(409)
  })
})
