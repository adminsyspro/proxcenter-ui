/**
 * GET + POST /api/v1/admin/vdcs/[id]/zone (#899): the desired zone next to
 * the one Proxmox runs, and the sync that rewrites it. Error mapping REAL.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

import { callRoute } from '@/__tests__/setup/route-test'

const { requireProviderTenantMock, checkPermissionMock, statusMock, syncMock, auditMock } = vi.hoisted(() => ({
  requireProviderTenantMock: vi.fn(),
  checkPermissionMock: vi.fn(),
  statusMock: vi.fn(),
  syncMock: vi.fn(),
  auditMock: vi.fn(),
}))

vi.mock('@/lib/tenant', () => ({ requireProviderTenant: (...a: unknown[]) => requireProviderTenantMock(...a) }))
vi.mock('@/lib/rbac', () => ({
  checkPermission: (...a: unknown[]) => checkPermissionMock(...a),
  PERMISSIONS: { ADMIN_SETTINGS: 'admin.settings' },
}))
vi.mock('@/lib/audit', () => ({ audit: (...a: unknown[]) => auditMock(...a) }))
vi.mock('@/lib/vdc/transportOps', () => ({
  getVdcZoneStatus: (...a: unknown[]) => statusMock(...a),
  syncVdcZone: (...a: unknown[]) => syncMock(...a),
}))

import { GET, POST } from './route'

const STATUS = { zoneName: 'zacme', desired: { peers: ['203.0.113.11'], mtu: null }, live: { type: 'vxlan', peers: ['203.0.113.11'], mtu: null, state: null, pending: null }, inSync: true }

beforeEach(() => {
  vi.clearAllMocks()
  requireProviderTenantMock.mockResolvedValue(null)
  checkPermissionMock.mockResolvedValue(null)
  statusMock.mockResolvedValue(STATUS)
  syncMock.mockResolvedValue({ ...STATUS, changed: true })
})

describe('gate', () => {
  it('400s without an id and 403s when the caller is not a provider admin', async () => {
    expect((await callRoute(GET as any, { params: {} })).status).toBe(400)
    requireProviderTenantMock.mockResolvedValueOnce(NextResponse.json({ error: 'forbidden' }, { status: 403 }))
    expect((await callRoute(GET as any, { params: { id: 'v1' } })).status).toBe(403)
    checkPermissionMock.mockResolvedValueOnce(NextResponse.json({ error: 'denied' }, { status: 403 }))
    expect((await callRoute(GET as any, { params: { id: 'v1' } })).status).toBe(403)
    expect(statusMock).not.toHaveBeenCalled()
  })
})

describe('GET .../zone', () => {
  it('returns the zone status', async () => {
    const res = await callRoute(GET as any, { params: { id: 'v1' } })
    expect(res.status).toBe(200)
    expect(statusMock).toHaveBeenCalledWith('v1')
    expect(await res.json()).toEqual({ data: STATUS })
  })

  it('maps not found to 404, a transport error to 400, anything else to 502', async () => {
    statusMock.mockRejectedValueOnce(new Error('vDC not found: v9'))
    expect((await callRoute(GET as any, { params: { id: 'v9' } })).status).toBe(404)
    statusMock.mockRejectedValueOnce(new Error('VXLAN transport: the transport network is incomplete.'))
    expect((await callRoute(GET as any, { params: { id: 'v1' } })).status).toBe(400)
    statusMock.mockRejectedValueOnce(new Error('This vDC has no SDN zone.'))
    expect((await callRoute(GET as any, { params: { id: 'v1' } })).status).toBe(400)
    statusMock.mockRejectedValueOnce(new Error('ECONNREFUSED'))
    expect((await callRoute(GET as any, { params: { id: 'v1' } })).status).toBe(502)
  })
})

describe('POST .../zone', () => {
  it('syncs the zone, audits the desired peers and MTU, and returns the result', async () => {
    const res = await callRoute(POST as any, { method: 'POST', params: { id: 'v1' } })
    expect(res.status).toBe(200)
    expect(syncMock).toHaveBeenCalledWith('v1')
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
      resourceType: 'vdc', resourceName: 'zacme',
      details: { operation: 'zone-sync', changed: true, peers: ['203.0.113.11'], mtu: null },
    }))
    expect(await res.json()).toEqual({ data: { ...STATUS, changed: true } })
  })

  it('maps a Proxmox refusal to 502 without auditing', async () => {
    syncMock.mockRejectedValueOnce(new Error('Failed to update SDN zone "zacme": 400 bad peer'))
    expect((await callRoute(POST as any, { method: 'POST', params: { id: 'v1' } })).status).toBe(502)
    expect(auditMock).not.toHaveBeenCalled()
  })
})
