/**
 * GET /api/v1/vdcs/{id}/evpn-networks and PUT .../{networkId} (#1334): what a
 * vDC attached to a shared EVPN zone can reach, and the vDCs carrying one of
 * the tenant's networks. The right is checked on every vDC the call changes.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

const h = vi.hoisted(() => ({
  checkVnetPermission: vi.fn(),
  evpnContextForVdc: vi.fn(),
  setEvpnNetworkPresence: vi.fn(),
  auditMock: vi.fn(),
}))

// API token guard: pass-through, these tests drive the session path (token
// paths: routeGuard.test.ts, tenancyTokenScope.test.ts).
vi.mock("@/lib/api-tokens/routeGuard", () => ({ withPublicApiGuard: (_entryId: string, handler: any) => handler }))
vi.mock('@/lib/tenant', () => ({ getCurrentTenantId: async () => 'tenant-a' }))
vi.mock('@/lib/rbac', () => ({
  PERMISSIONS: { SDN_VNET_VIEW: 'sdn.vnet.view', SDN_VNET_CREATE: 'sdn.vnet.create', SDN_VNET_EDIT: 'sdn.vnet.edit', SDN_VNET_DELETE: 'sdn.vnet.delete' },
}))
vi.mock('@/lib/vdc/vnetPermission', () => ({ checkVnetPermission: (...a: unknown[]) => h.checkVnetPermission(...a) }))
vi.mock('@/lib/vdc/evpnNetworks', () => ({
  evpnContextForVdc: (...a: unknown[]) => h.evpnContextForVdc(...a),
  setEvpnNetworkPresence: (...a: unknown[]) => h.setEvpnNetworkPresence(...a),
}))
vi.mock('@/lib/audit', () => ({ audit: (...a: unknown[]) => h.auditMock(...a) }))

import { GET } from './route'
import { PUT } from './[networkId]/route'

const CONTEXT = {
  available: true,
  vdcs: [{ id: 'a1', name: 'Acme Paris' }, { id: 'a2', name: 'Acme Lyon' }, { id: 'a3', name: 'Acme Nice' }],
  networks: [{ id: 'n1', name: 'backbone', vdcIds: ['a1', 'a2'] }],
}
const denied = () => NextResponse.json({ error: 'vDC not found' }, { status: 404 })
const put = (body: unknown, params: Record<string, string> = { id: 'a1', networkId: 'n1' }) =>
  callRoute(PUT as any, { method: 'PUT', params, body: body as any })

beforeEach(() => {
  vi.clearAllMocks()
  h.checkVnetPermission.mockResolvedValue(null)
  h.evpnContextForVdc.mockResolvedValue(CONTEXT)
  h.setEvpnNetworkPresence.mockResolvedValue({ vdcIds: ['a1', 'a3'] })
})

describe('GET /api/v1/vdcs/[id]/evpn-networks', () => {
  it('returns the context of the vDC for the caller tenant, behind the view right', async () => {
    const res = await callRoute(GET as any, { params: { id: 'a1' } })
    expect(await readJson<any>(res)).toEqual({ data: CONTEXT })
    expect(h.checkVnetPermission).toHaveBeenCalledWith(undefined, 'a1', 'sdn.vnet.view')
    expect(h.evpnContextForVdc).toHaveBeenCalledWith('a1', 'tenant-a')
  })

  it('answers the refusal of the permission check, and 400 without an id', async () => {
    h.checkVnetPermission.mockResolvedValueOnce(denied())
    expect((await callRoute(GET as any, { params: { id: 'b1' } })).status).toBe(404)
    expect((await callRoute(GET as any, { params: {} })).status).toBe(400)
    expect(h.evpnContextForVdc).not.toHaveBeenCalled()
  })

  it('offers nothing to the provider tenant, and 500s on an unexpected failure', async () => {
    h.evpnContextForVdc.mockRejectedValueOnce(new Error('vDC not found'))
    expect(await readJson<any>(await callRoute(GET as any, { params: { id: 'a1' } }))).toEqual({ data: { available: false, vdcs: [], networks: [] } })
    h.evpnContextForVdc.mockRejectedValueOnce(new Error('boom'))
    expect((await callRoute(GET as any, { params: { id: 'a1' } })).status).toBe(500)
  })
})

describe('PUT /api/v1/vdcs/[id]/evpn-networks/[networkId]', () => {
  it('sets the presence after checking the right on each vDC it adds or removes', async () => {
    const res = await put({ vdcIds: ['a1', 'a3', 'a3', 7] })
    expect(await readJson<any>(res)).toEqual({ data: { vdcIds: ['a1', 'a3'] } })
    expect(h.setEvpnNetworkPresence).toHaveBeenCalledWith('n1', 'tenant-a', ['a1', 'a3'])
    expect(h.checkVnetPermission.mock.calls.map(c => [c[1], c[2]])).toEqual([
      ['a1', 'sdn.vnet.edit'], ['a3', 'sdn.vnet.create'], ['a2', 'sdn.vnet.delete'],
    ])
  })

  it('stops on the first vDC the caller may not change, before any write', async () => {
    h.checkVnetPermission.mockImplementation(async (_p: unknown, vdcId: string, permission: string) =>
      vdcId === 'a3' && permission === 'sdn.vnet.create' ? denied() : null)
    expect((await put({ vdcIds: ['a1', 'a2', 'a3'] })).status).toBe(404)
    h.checkVnetPermission.mockImplementation(async (_p: unknown, vdcId: string, permission: string) =>
      vdcId === 'a2' && permission === 'sdn.vnet.delete' ? denied() : null)
    expect((await put({ vdcIds: ['a1'] })).status).toBe(404)
    expect(h.setEvpnNetworkPresence).not.toHaveBeenCalled()
  })

  it('validates the call', async () => {
    expect((await put({ vdcIds: ['a1'] }, { id: 'a1' })).status).toBe(400)
    expect((await put({ vdcIds: 'a1' })).status).toBe(400)
    expect((await put({ vdcIds: ['a1'] }, { id: 'a1', networkId: 'ghost' })).status).toBe(404)
    h.checkVnetPermission.mockResolvedValueOnce(denied())
    expect((await put({ vdcIds: ['a1'] })).status).toBe(404)
  })

  it('maps the refusals of the module', async () => {
    const cases: Array<[Error, number]> = [
      [new Error('Quota exceeded on vDC "Acme Nice": max_vnets=2, current=2'), 409],
      [new Error('Tenant network: a network must stay on at least one vDC. Delete it instead.'), 400],
      [new Error('Tenant network: 1 guest NIC(s) still use "backbone" on vDC "Acme Lyon". Detach them first.'), 409],
      [new Error('Failed to create SDN VNet "backbone": 400'), 502],
      [new Error('vDC not found'), 404],
      [new Error('boom'), 500],
    ]
    for (const [error, status] of cases) {
      h.setEvpnNetworkPresence.mockRejectedValueOnce(error)
      expect((await put({ vdcIds: ['a1', 'a2'] })).status).toBe(status)
    }
  })
})
