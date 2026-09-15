/**
 * GET + POST /api/v1/admin/tenant-networks (#901): provider-only listing and
 * creation of stretched tenant networks. The error mapping is kept REAL so
 * the business refusals of the module surface as 409/400 rather than 500.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

import { callRoute } from '@/__tests__/setup/route-test'

const { requireProviderTenantMock, checkPermissionMock, listMock, createMock, auditMock } = vi.hoisted(() => ({
  requireProviderTenantMock: vi.fn(),
  checkPermissionMock: vi.fn(),
  listMock: vi.fn(),
  createMock: vi.fn(),
  auditMock: vi.fn(),
}))

vi.mock('@/lib/tenant', () => ({ requireProviderTenant: (...a: unknown[]) => requireProviderTenantMock(...a) }))
vi.mock('@/lib/rbac', () => ({
  checkPermission: (...a: unknown[]) => checkPermissionMock(...a),
  PERMISSIONS: { ADMIN_SETTINGS: 'admin.settings' },
}))
vi.mock('@/lib/audit', () => ({ audit: (...a: unknown[]) => auditMock(...a) }))
vi.mock('next-auth', () => ({ getServerSession: vi.fn().mockResolvedValue({ user: { id: 'admin-1' } }) }))
vi.mock('@/lib/auth/config', () => ({ authOptions: {} }))
vi.mock('@/lib/vdc/tenantNetworks', () => ({
  listTenantNetworks: (...a: unknown[]) => listMock(...a),
  createTenantNetwork: (...a: unknown[]) => createMock(...a),
}))

import { GET, POST } from './route'

const NETWORK = { id: 'n1', tenantId: 't1', name: 'backbone', vni: 10002, mtu: null, pveName: 'v32cf5fc', members: [] }
const BODY = { tenantId: 't1', name: 'backbone', subnet: { cidr: '192.0.2.0/24', gateway: '192.0.2.1' } }

// GET reads req.nextUrl (NextRequest); callRoute builds a plain Request.
const nextReq = (url: string) => ({ nextUrl: new URL(url) }) as any

beforeEach(() => {
  vi.clearAllMocks()
  requireProviderTenantMock.mockResolvedValue(null)
  checkPermissionMock.mockResolvedValue(null)
  listMock.mockResolvedValue([NETWORK])
  createMock.mockResolvedValue(NETWORK)
})

describe('GET /api/v1/admin/tenant-networks', () => {
  it('is provider-gated', async () => {
    requireProviderTenantMock.mockResolvedValue(NextResponse.json({ error: 'forbidden' }, { status: 403 }))
    const res = await GET(nextReq('http://test/api/v1/admin/tenant-networks'))
    expect(res.status).toBe(403)
    expect(listMock).not.toHaveBeenCalled()
  })

  it('is permission-gated', async () => {
    checkPermissionMock.mockResolvedValue(NextResponse.json({ error: 'denied' }, { status: 403 }))
    const res = await GET(nextReq('http://test/api/v1/admin/tenant-networks'))
    expect(res.status).toBe(403)
  })

  it('lists the networks, forwarding the optional tenant filter', async () => {
    const res = await GET(nextReq('http://test/api/v1/admin/tenant-networks?tenantId=t1'))
    expect(res.status).toBe(200)
    expect(listMock).toHaveBeenCalledWith('t1')
    expect(await res.json()).toEqual({ data: [NETWORK] })
  })

  it('maps a module failure to 500', async () => {
    listMock.mockRejectedValue(new Error('boom'))
    const res = await GET(nextReq('http://test/api/v1/admin/tenant-networks'))
    expect(res.status).toBe(500)
  })
})

describe('POST /api/v1/admin/tenant-networks', () => {
  it('400s without tenantId or name', async () => {
    const res = await callRoute(POST as any, { method: 'POST', body: { name: 'x' } })
    expect(res.status).toBe(400)
    expect(createMock).not.toHaveBeenCalled()
  })

  it('creates the network with its subnet, VNI and MTU, audits, and returns 201', async () => {
    const res = await callRoute(POST as any, { method: 'POST', body: { ...BODY, vni: 4242, mtu: 1400, description: 'spine' } })
    expect(res.status).toBe(201)
    expect(createMock).toHaveBeenCalledWith(
      { tenantId: 't1', name: 'backbone', description: 'spine', vni: 4242, mtu: 1400, subnet: BODY.subnet },
      'admin-1',
    )
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'create', resourceType: 'tenant-network', resourceId: 'n1' }))
    expect(await res.json()).toEqual({ data: NETWORK })
  })

  it('answers 409 to a name or VNI already taken, 400 to an invalid input', async () => {
    createMock.mockRejectedValueOnce(new Error('Tenant network: VNI 10001 is already used by network "dmz" of vDC "MSP-vDC".'))
    expect((await callRoute(POST as any, { method: 'POST', body: BODY })).status).toBe(409)
    createMock.mockRejectedValueOnce(new Error('Tenant network: MTU must be an integer between 1280 and 9000.'))
    expect((await callRoute(POST as any, { method: 'POST', body: BODY })).status).toBe(400)
    createMock.mockRejectedValueOnce(Object.assign(new Error('unique'), { code: 'P2002' }))
    expect((await callRoute(POST as any, { method: 'POST', body: BODY })).status).toBe(409)
    expect(auditMock).not.toHaveBeenCalled()
  })
})
