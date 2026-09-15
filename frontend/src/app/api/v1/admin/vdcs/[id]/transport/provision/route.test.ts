/**
 * GET + POST /api/v1/admin/vdcs/[id]/transport/provision (#899): the state of
 * the transport interface on each node, and its provisioning. Error mapping
 * REAL; a failing node makes the audit a failure but not the response.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

import { callRoute } from '@/__tests__/setup/route-test'

const { requireProviderTenantMock, checkPermissionMock, statusMock, provisionMock, auditMock } = vi.hoisted(() => ({
  requireProviderTenantMock: vi.fn(),
  checkPermissionMock: vi.fn(),
  statusMock: vi.fn(),
  provisionMock: vi.fn(),
  auditMock: vi.fn(),
}))

vi.mock('@/lib/tenant', () => ({ requireProviderTenant: (...a: unknown[]) => requireProviderTenantMock(...a) }))
vi.mock('@/lib/rbac', () => ({
  checkPermission: (...a: unknown[]) => checkPermissionMock(...a),
  PERMISSIONS: { ADMIN_SETTINGS: 'admin.settings' },
}))
vi.mock('@/lib/audit', () => ({ audit: (...a: unknown[]) => auditMock(...a) }))
vi.mock('@/lib/vdc/transportOps', () => ({
  getVdcTransportStatus: (...a: unknown[]) => statusMock(...a),
  provisionVdcTransport: (...a: unknown[]) => provisionMock(...a),
}))

import { GET, POST } from './route'

const NODES = [{ node: 'pve1', iface: 'vmbr0.4000', state: 'provisioned', wanted: '198.51.100.1/24', found: '198.51.100.1/24' }]

beforeEach(() => {
  vi.clearAllMocks()
  requireProviderTenantMock.mockResolvedValue(null)
  checkPermissionMock.mockResolvedValue(null)
  statusMock.mockResolvedValue(NODES)
  provisionMock.mockResolvedValue([{ node: 'pve1', action: 'created' }, { node: 'pve2', action: 'unchanged' }])
})

describe('gate', () => {
  it('400s without an id and 403s for a non-provider or unpermitted caller', async () => {
    expect((await callRoute(GET as any, { params: {} })).status).toBe(400)
    requireProviderTenantMock.mockResolvedValueOnce(NextResponse.json({ error: 'forbidden' }, { status: 403 }))
    expect((await callRoute(GET as any, { params: { id: 'v1' } })).status).toBe(403)
    checkPermissionMock.mockResolvedValueOnce(NextResponse.json({ error: 'denied' }, { status: 403 }))
    expect((await callRoute(POST as any, { method: 'POST', params: { id: 'v1' } })).status).toBe(403)
    expect(statusMock).not.toHaveBeenCalled()
    expect(provisionMock).not.toHaveBeenCalled()
  })
})

describe('GET .../transport/provision', () => {
  it('returns what each node carries', async () => {
    const res = await callRoute(GET as any, { params: { id: 'v1' } })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ data: { nodes: NODES } })
  })

  it('maps not found to 404, a transport error to 400, a node failure to 502', async () => {
    statusMock.mockRejectedValueOnce(new Error('vDC not found: v9'))
    expect((await callRoute(GET as any, { params: { id: 'v9' } })).status).toBe(404)
    statusMock.mockRejectedValueOnce(new Error('VXLAN transport: the vDC is not in transport network mode.'))
    expect((await callRoute(GET as any, { params: { id: 'v1' } })).status).toBe(400)
    statusMock.mockRejectedValueOnce(new Error('ETIMEDOUT'))
    expect((await callRoute(GET as any, { params: { id: 'v1' } })).status).toBe(502)
  })
})

describe('POST .../transport/provision', () => {
  it('provisions every node and audits a success when none failed', async () => {
    const res = await callRoute(POST as any, { method: 'POST', params: { id: 'v1' } })
    expect(res.status).toBe(200)
    expect(provisionMock).toHaveBeenCalledWith('v1')
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'success', details: expect.objectContaining({ operation: 'transport-provision' }) }))
    expect(await res.json()).toEqual({ data: { results: [{ node: 'pve1', action: 'created' }, { node: 'pve2', action: 'unchanged' }] } })
  })

  it('still answers 200 when a node failed, but audits a failure', async () => {
    provisionMock.mockResolvedValueOnce([{ node: 'pve1', action: 'created' }, { node: 'pve2', action: 'error', message: 'ifreload failed' }])
    const res = await callRoute(POST as any, { method: 'POST', params: { id: 'v1' } })
    expect(res.status).toBe(200)
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ status: 'failure' }))
  })

  it('maps a transport definition error to 400 without auditing', async () => {
    provisionMock.mockRejectedValueOnce(new Error('VXLAN transport: the transport network is incomplete.'))
    expect((await callRoute(POST as any, { method: 'POST', params: { id: 'v1' } })).status).toBe(400)
    expect(auditMock).not.toHaveBeenCalled()
  })
})
