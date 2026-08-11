/**
 * GET + POST /api/v1/admin/vdcs — provider-only vDC listing and creation.
 * POST pins the request validation and the createVdc error mapping
 * (mapCreateVdcError kept REAL): business-rule rejections and P2002 races
 * surface as 409/400 instead of 500.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { callRoute } from '@/__tests__/setup/route-test'

const { requireProviderTenantMock, checkPermissionMock, listVdcsMock, createVdcMock, auditMock } = vi.hoisted(() => ({
  requireProviderTenantMock: vi.fn(),
  checkPermissionMock: vi.fn(),
  listVdcsMock: vi.fn(),
  createVdcMock: vi.fn(),
  auditMock: vi.fn(),
}))

vi.mock('@/lib/tenant', () => ({
  requireProviderTenant: (...a: unknown[]) => requireProviderTenantMock(...a),
}))

vi.mock('@/lib/rbac', () => ({
  checkPermission: (...a: unknown[]) => checkPermissionMock(...a),
  PERMISSIONS: { ADMIN_SETTINGS: 'admin.settings' },
}))

vi.mock('@/lib/vdc', () => ({
  listVdcs: (...a: unknown[]) => listVdcsMock(...a),
  createVdc: (...a: unknown[]) => createVdcMock(...a),
}))

vi.mock('@/lib/audit', () => ({ audit: (...a: unknown[]) => auditMock(...a) }))

vi.mock('next-auth', () => ({
  getServerSession: vi.fn().mockResolvedValue({ user: { id: 'admin-1' } }),
}))

vi.mock('@/lib/auth/config', () => ({ authOptions: {} }))

import { GET, POST } from './route'
import { NextResponse } from 'next/server'

const VALID_BODY = {
  tenantId: 't1',
  connectionId: 'c1',
  name: 'ACME — Paris',
  slug: 'vdc-acme-paris',
  nodes: ['pve1'],
  primaryStorage: ' shared-nfs ',
  sharedBridges: ['vmbr0'],
}

beforeEach(() => {
  vi.clearAllMocks()
  requireProviderTenantMock.mockResolvedValue(null)
  checkPermissionMock.mockResolvedValue(null)
  listVdcsMock.mockResolvedValue([{ id: 'vdc-1' }])
  createVdcMock.mockResolvedValue({ id: 'vdc-new', name: 'ACME — Paris' })
})

// The GET handler reads req.nextUrl (NextRequest); callRoute builds a plain
// Request, so stub the one property the handler touches.
const nextReq = (url: string) => ({ nextUrl: new URL(url) }) as any

describe('GET /api/v1/admin/vdcs', () => {
  it('is provider-gated', async () => {
    requireProviderTenantMock.mockResolvedValue(NextResponse.json({ error: 'forbidden' }, { status: 403 }))

    const res = await GET(nextReq('http://test/api/v1/admin/vdcs'))
    expect(res.status).toBe(403)
    expect(listVdcsMock).not.toHaveBeenCalled()
  })

  it('lists vDCs, forwarding the optional tenantId filter', async () => {
    const res = await GET(nextReq('http://test/api/v1/admin/vdcs?tenantId=t1'))

    expect(res.status).toBe(200)
    expect(listVdcsMock).toHaveBeenCalledWith('t1')
    expect(await res.json()).toEqual({ data: [{ id: 'vdc-1' }] })
  })
})

describe('POST /api/v1/admin/vdcs', () => {
  it('400s when a required field is missing', async () => {
    const { slug: _slug, ...noSlug } = VALID_BODY

    const res = await callRoute(POST as Parameters<typeof callRoute>[0], { method: 'POST', body: noSlug })
    expect(res.status).toBe(400)
    expect(createVdcMock).not.toHaveBeenCalled()
  })

  it('400s on an invalid slug', async () => {
    const res = await callRoute(POST as Parameters<typeof callRoute>[0], {
      method: 'POST',
      body: { ...VALID_BODY, slug: 'Not A Slug!' },
    })
    expect(res.status).toBe(400)
  })

  it('400s on an empty nodes array and on a missing primaryStorage', async () => {
    const resNodes = await callRoute(POST as Parameters<typeof callRoute>[0], {
      method: 'POST',
      body: { ...VALID_BODY, nodes: [] },
    })
    expect(resNodes.status).toBe(400)

    const resStorage = await callRoute(POST as Parameters<typeof callRoute>[0], {
      method: 'POST',
      body: { ...VALID_BODY, primaryStorage: '   ' },
    })
    expect(resStorage.status).toBe(400)
  })

  it('creates the vDC (trimmed primaryStorage, sharedBridges forwarded), audits, returns 201', async () => {
    const res = await callRoute(POST as Parameters<typeof callRoute>[0], { method: 'POST', body: VALID_BODY })

    expect(res.status).toBe(201)
    expect(createVdcMock).toHaveBeenCalledWith(
      expect.objectContaining({ primaryStorage: 'shared-nfs', sharedBridges: ['vmbr0'] }),
      'admin-1',
    )
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'create', resourceType: 'vdc' }))
    expect((await res.json()).data.id).toBe('vdc-new')
  })

  it('maps a P2002 unique-constraint race to 409', async () => {
    createVdcMock.mockRejectedValue(Object.assign(new Error('unique violation'), { code: 'P2002' }))

    const res = await callRoute(POST as Parameters<typeof callRoute>[0], { method: 'POST', body: VALID_BODY })
    expect(res.status).toBe(409)
  })

  it('maps the one-vDC-per-cluster guard to 409 and pool violations to 400', async () => {
    createVdcMock.mockRejectedValue(new Error('Tenant already has a vDC on this cluster'))
    const res409 = await callRoute(POST as Parameters<typeof callRoute>[0], { method: 'POST', body: VALID_BODY })
    expect(res409.status).toBe(409)

    createVdcMock.mockRejectedValue(new Error('Connection is not in the provider pool'))
    const res400 = await callRoute(POST as Parameters<typeof callRoute>[0], { method: 'POST', body: VALID_BODY })
    expect(res400.status).toBe(400)
  })

  it('keeps unexpected errors as 500', async () => {
    createVdcMock.mockRejectedValue(new Error('database on fire'))

    const res = await callRoute(POST as Parameters<typeof callRoute>[0], { method: 'POST', body: VALID_BODY })
    expect(res.status).toBe(500)
  })
})
