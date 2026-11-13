/**
 * The /api/v1/admin/evpn-zones routes (#1334): provider-only declaration of
 * the EVPN zones shared between clusters, their members, their state and the
 * audit of the VNIs two clusters share. The gate and the error mapping are
 * kept REAL so a business refusal surfaces as 409/400/404 rather than 500.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest, NextResponse } from 'next/server'

import { callRoute } from '@/__tests__/setup/route-test'

const { requireProviderTenantMock, checkPermissionMock, auditMock, zones, collisions } = vi.hoisted(() => ({
  requireProviderTenantMock: vi.fn(),
  checkPermissionMock: vi.fn(),
  auditMock: vi.fn(),
  zones: {
    listEvpnZones: vi.fn(), createEvpnZone: vi.fn(), discoverEvpn: vi.fn(), getEvpnZone: vi.fn(), getEvpnZoneStatus: vi.fn(),
    updateEvpnZone: vi.fn(), deleteEvpnZone: vi.fn(), addEvpnZoneMember: vi.fn(), removeEvpnZoneMember: vi.fn(), resyncEvpnZoneMember: vi.fn(),
  },
  collisions: { auditVniCollisions: vi.fn(), renumberVnet: vi.fn() },
}))

// API token guard: pass-through, these tests drive the session path (token
// paths: routeGuard.test.ts, tenancyTokenScope.test.ts).
vi.mock("@/lib/api-tokens/routeGuard", () => ({ withPublicApiGuard: (_entryId: string, handler: any) => handler }))
vi.mock("@/lib/auth/actingUser", async () => (await import("@/__tests__/fixtures/actingUserFromNextAuth")).actingUserFromNextAuth())
vi.mock('@/lib/tenant', () => ({ requireProviderTenant: (...a: unknown[]) => requireProviderTenantMock(...a) }))
vi.mock('@/lib/rbac', () => ({
  checkPermission: (...a: unknown[]) => checkPermissionMock(...a),
  PERMISSIONS: { ADMIN_SETTINGS: 'admin.settings' },
}))
vi.mock('@/lib/audit', async () => {
  const { markAuditExplicit } = await vi.importActual<typeof import('@/lib/audit/scope')>('@/lib/audit/scope')
  return { audit: (...a: unknown[]) => { markAuditExplicit(); return auditMock(...a) } }
})
vi.mock('next-auth', () => ({ getServerSession: vi.fn().mockResolvedValue({ user: { id: 'admin-1' } }) }))
vi.mock('@/lib/auth/config', () => ({ authOptions: {} }))
vi.mock('@/lib/vdc/evpnZones', () => zones)
vi.mock('@/lib/vdc/vniCollisions', () => collisions)

import * as root from './route'
import * as discover from './discover/route'
import * as collisionsRoute from './collisions/route'
import * as item from './[id]/route'
import * as members from './[id]/members/route'

const ZONE = {
  id: 'z1', name: 'Shared', description: null, zoneName: 'zshared', vrfVxlan: 9000, mtu: 1450, vniStart: 9001, vniEnd: 9099,
  members: [{ id: 'm1', connectionId: 'c1', connectionName: 'paris', controller: 'evpn1', controllerCreated: true, adopted: false }],
}
const STATUS = [{ connectionId: 'c1', connectionName: 'paris', state: 'ok', detail: null, vnetCount: 0 }]
const BODY = { name: 'Shared', zoneName: 'zshared', vrfVxlan: 9000, mtu: 1450, vniStart: 9001, vniEnd: 9099, members: [{ connectionId: 'c1', controller: { mode: 'existing', name: 'evpn1' } }] }

const nextReq = (url: string, method = 'GET') => new NextRequest(url, { method })
const ctx = (id?: string): any => ({ params: Promise.resolve(id ? { id } : {}) })
const forbidden = () => NextResponse.json({ error: 'forbidden' }, { status: 403 })

beforeEach(() => {
  vi.clearAllMocks()
  requireProviderTenantMock.mockResolvedValue(null)
  checkPermissionMock.mockResolvedValue(null)
  zones.listEvpnZones.mockResolvedValue([ZONE])
  zones.createEvpnZone.mockResolvedValue({ zone: ZONE, applyErrors: [] })
  zones.discoverEvpn.mockResolvedValue([{ connectionId: 'c1' }])
  zones.getEvpnZone.mockResolvedValue(ZONE)
  zones.getEvpnZoneStatus.mockResolvedValue(STATUS)
  zones.updateEvpnZone.mockResolvedValue({ ...ZONE, name: 'Renamed' })
  zones.deleteEvpnZone.mockResolvedValue([])
  zones.addEvpnZoneMember.mockResolvedValue({ zone: ZONE, applyErrors: [] })
  zones.removeEvpnZoneMember.mockResolvedValue({ zone: { ...ZONE, members: [] }, applyErrors: [{ connectionName: 'paris', error: 'ifreload failed' }] })
  zones.resyncEvpnZoneMember.mockResolvedValue(STATUS[0])
  collisions.auditVniCollisions.mockResolvedValue({ collisions: [], unreachable: [] })
  collisions.renumberVnet.mockResolvedValue({ vdcVnetId: 'vn-1', previousVni: 10001, vni: 10003 })
})

describe('gate', () => {
  it('every route is refused outside the provider tenant and without the settings permission', async () => {
    const calls = [
      () => root.GET(new Request("http://t/api/v1/admin/evpn-zones")),
      () => callRoute(root.POST as any, { method: 'POST', body: BODY }),
      () => discover.GET(nextReq('http://test/x?connectionIds=c1')),
      () => collisionsRoute.GET(),
      () => callRoute(collisionsRoute.POST as any, { method: 'POST', body: { vdcVnetId: 'vn-1' } }),
      () => item.GET(nextReq('http://test/x'), ctx('z1')),
      () => callRoute(item.PUT as any, { method: 'PUT', params: { id: 'z1' }, body: {} }),
      () => callRoute(item.DELETE as any, { method: 'DELETE', params: { id: 'z1' } }),
      () => callRoute(members.POST as any, { method: 'POST', params: { id: 'z1' }, body: {} }),
      () => callRoute(members.PUT as any, { method: 'PUT', params: { id: 'z1' }, body: { connectionId: 'c1' } }),
      () => members.DELETE(nextReq('http://test/x?connectionId=c1', 'DELETE'), ctx('z1')),
    ]
    for (const call of calls) {
      requireProviderTenantMock.mockResolvedValueOnce(forbidden())
      expect((await call()).status).toBe(403)
      checkPermissionMock.mockResolvedValueOnce(forbidden())
      expect((await call()).status).toBe(403)
    }
    for (const fn of [...Object.values(zones), ...Object.values(collisions)]) expect(fn).not.toHaveBeenCalled()
  })
})

describe('/evpn-zones', () => {
  it('lists the zones', async () => {
    const res = await root.GET(new Request("http://t/api/v1/admin/evpn-zones"))
    expect(await res.json()).toEqual({ data: [ZONE] })
    zones.listEvpnZones.mockRejectedValueOnce(new Error('boom'))
    expect((await root.GET(new Request("http://t/api/v1/admin/evpn-zones"))).status).toBe(500)
  })

  it('declares a zone, audits what it created, and returns 201 with the apply errors', async () => {
    const res = await callRoute(root.POST as any, { method: 'POST', body: { ...BODY, description: 'core' } })
    expect(res.status).toBe(201)
    expect(zones.createEvpnZone).toHaveBeenCalledWith({ ...BODY, description: 'core' }, 'admin-1')
    expect(await res.json()).toEqual({ data: ZONE, applyErrors: [] })
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
      action: 'create', resourceType: 'evpn-zone', resourceId: 'z1',
      details: expect.objectContaining({ zoneName: 'zshared', vniRange: '9001-9099', clusters: ['paris'], controllersCreated: ['evpn1'] }),
    }))
  })

  it('answers 409, 400 and 502 to the refusals of the module', async () => {
    zones.createEvpnZone.mockRejectedValueOnce(new Error('EVPN zone: a zone named "Shared" already exists.'))
    expect((await callRoute(root.POST as any, { method: 'POST', body: BODY })).status).toBe(409)
    zones.createEvpnZone.mockRejectedValueOnce(new Error('EVPN zone: select at least one cluster.'))
    expect((await callRoute(root.POST as any, { method: 'POST', body: BODY })).status).toBe(400)
    zones.createEvpnZone.mockRejectedValueOnce(new Error('Failed to create SDN zone "zshared": 400'))
    expect((await callRoute(root.POST as any, { method: 'POST', body: BODY })).status).toBe(502)
  })
})

describe('/evpn-zones/discover', () => {
  it('reads the clusters asked for, and nothing without a cluster', async () => {
    const res = await discover.GET(nextReq('http://test/x?connectionIds=c1,%20c2,,'))
    expect(zones.discoverEvpn).toHaveBeenCalledWith(['c1', 'c2'])
    expect(await res.json()).toEqual({ data: [{ connectionId: 'c1' }] })
    expect(await (await discover.GET(nextReq('http://test/x'))).json()).toEqual({ data: [] })
    expect(zones.discoverEvpn).toHaveBeenCalledTimes(1)
    zones.discoverEvpn.mockRejectedValueOnce(new Error('boom'))
    expect((await discover.GET(nextReq('http://test/x?connectionIds=c1'))).status).toBe(500)
  })
})

describe('/evpn-zones/collisions', () => {
  it('returns the audit', async () => {
    expect(await (await collisionsRoute.GET()).json()).toEqual({ data: { collisions: [], unreachable: [] } })
    collisions.auditVniCollisions.mockRejectedValueOnce(new Error('boom'))
    expect((await collisionsRoute.GET()).status).toBe(500)
  })

  it('moves a network to a free VNI and audits both numbers', async () => {
    expect((await callRoute(collisionsRoute.POST as any, { method: 'POST', body: {} })).status).toBe(400)
    const res = await callRoute(collisionsRoute.POST as any, { method: 'POST', body: { vdcVnetId: 'vn-1' } })
    expect(await res.json()).toEqual({ data: { vdcVnetId: 'vn-1', previousVni: 10001, vni: 10003 } })
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
      resourceType: 'vdc-vnet', resourceId: 'vn-1', details: { previousVni: 10001, vni: 10003, reason: 'vni-collision' },
    }))
    collisions.renumberVnet.mockRejectedValueOnce(new Error('VNI collision: network not found.'))
    expect((await callRoute(collisionsRoute.POST as any, { method: 'POST', body: { vdcVnetId: 'ghost' } })).status).toBe(404)
  })
})

describe('/evpn-zones/[id]', () => {
  it('needs an id', async () => {
    expect((await item.GET(nextReq('http://test/x'), ctx())).status).toBe(400)
    expect((await callRoute(members.POST as any, { method: 'POST', params: {}, body: {} })).status).toBe(400)
  })

  it('returns the zone with the state of each cluster', async () => {
    const res = await item.GET(nextReq('http://test/x'), ctx('z1'))
    expect(await res.json()).toEqual({ data: { ...ZONE, status: STATUS } })
    zones.getEvpnZone.mockRejectedValueOnce(new Error('EVPN zone: not found.'))
    expect((await item.GET(nextReq('http://test/x'), ctx('ghost'))).status).toBe(404)
  })

  it('updates the name, the description and the range only', async () => {
    const res = await callRoute(item.PUT as any, { method: 'PUT', params: { id: 'z1' }, body: { name: 'Renamed', description: 'd', vniStart: 9001, vniEnd: 9199, vrfVxlan: 1 } })
    expect(zones.updateEvpnZone).toHaveBeenCalledWith('z1', { name: 'Renamed', description: 'd', vniStart: 9001, vniEnd: 9199 })
    expect((await res.json()).data.name).toBe('Renamed')
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'update', resourceType: 'evpn-zone' }))
    zones.updateEvpnZone.mockRejectedValueOnce(new Error('EVPN zone: the VNI range overlaps the range 1-2 of vDC "v".'))
    expect((await callRoute(item.PUT as any, { method: 'PUT', params: { id: 'z1' }, body: {} })).status).toBe(409)
  })

  it('deletes the zone and returns the clusters whose apply failed', async () => {
    zones.deleteEvpnZone.mockResolvedValueOnce([{ connectionName: 'paris', error: 'ifreload failed' }])
    const res = await callRoute(item.DELETE as any, { method: 'DELETE', params: { id: 'z1' } })
    expect(await res.json()).toEqual({ data: { success: true }, applyErrors: [{ connectionName: 'paris', error: 'ifreload failed' }] })
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: 'delete', details: expect.objectContaining({ applyErrors: 1 }) }))
    zones.deleteEvpnZone.mockRejectedValueOnce(new Error('EVPN zone: zone "zshared" still holds 1 VNet(s) on cluster "paris".'))
    expect((await callRoute(item.DELETE as any, { method: 'DELETE', params: { id: 'z1' } })).status).toBe(409)
  })
})

describe('/evpn-zones/[id]/members', () => {
  it('extends the zone to one more cluster', async () => {
    const member = { connectionId: 'c2', controller: { mode: 'existing', name: 'evpn1' } }
    const res = await callRoute(members.POST as any, { method: 'POST', params: { id: 'z1' }, body: member })
    expect(res.status).toBe(201)
    expect(zones.addEvpnZoneMember).toHaveBeenCalledWith('z1', member)
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ details: expect.objectContaining({ added: 'c2' }) }))
    zones.addEvpnZoneMember.mockRejectedValueOnce(new Error('EVPN zone: this cluster already carries the zone.'))
    expect((await callRoute(members.POST as any, { method: 'POST', params: { id: 'z1' }, body: member })).status).toBe(409)
  })

  it('resyncs one cluster', async () => {
    expect((await callRoute(members.PUT as any, { method: 'PUT', params: { id: 'z1' }, body: {} })).status).toBe(400)
    const res = await callRoute(members.PUT as any, { method: 'PUT', params: { id: 'z1' }, body: { connectionId: 'c1' } })
    expect(zones.resyncEvpnZoneMember).toHaveBeenCalledWith('z1', 'c1')
    expect(await res.json()).toEqual({ data: STATUS[0] })
    zones.resyncEvpnZoneMember.mockRejectedValueOnce(new Error('EVPN zone: zone "z" differs on cluster "c" (MTU 1400): fix it in Proxmox.'))
    expect((await callRoute(members.PUT as any, { method: 'PUT', params: { id: 'z1' }, body: { connectionId: 'c1' } })).status).toBe(409)
  })

  it('detaches one cluster and returns the apply errors', async () => {
    expect((await members.DELETE(nextReq('http://test/x', 'DELETE'), ctx('z1'))).status).toBe(400)
    const res = await members.DELETE(nextReq('http://test/x?connectionId=c1', 'DELETE'), ctx('z1'))
    expect(zones.removeEvpnZoneMember).toHaveBeenCalledWith('z1', 'c1')
    expect((await res.json()).applyErrors).toEqual([{ connectionName: 'paris', error: 'ifreload failed' }])
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ details: expect.objectContaining({ removed: 'c1' }) }))
    zones.removeEvpnZoneMember.mockRejectedValueOnce(new Error('EVPN zone: this cluster does not carry the zone.'))
    expect((await members.DELETE(nextReq('http://test/x?connectionId=c9', 'DELETE'), ctx('z1'))).status).toBe(400)
  })
})
