/**
 * Issue #1360, read-only multi-tenant layer: real routes and real guard, an
 * API token principal. A token restricted to some connections only sees the
 * vDCs, EVPN zones and moves on them (404 for one outside, before Proxmox is
 * read), and each handler asks for the read-only admin right of its scope.
 * The principal, tenant, RBAC verdict, creator check and domain libraries are
 * stubbed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  headers: vi.fn<() => Promise<Headers>>(),
  getPrincipal: vi.fn<(...a: any[]) => Promise<any>>(),
  checkPermission: vi.fn<(...a: any[]) => Promise<Response | null>>(),
  creator: vi.fn<(...a: any[]) => Promise<boolean>>(),
  audit: vi.fn<(...a: any[]) => Promise<string>>(),
  listVdcs: vi.fn<(...a: any[]) => Promise<any[]>>(),
  getVdcById: vi.fn<(...a: any[]) => Promise<any>>(),
  listZones: vi.fn<(...a: any[]) => Promise<any[]>>(),
  getZone: vi.fn<(...a: any[]) => Promise<any>>(),
  zoneStatus: vi.fn<(...a: any[]) => Promise<any[]>>(),
  listMoves: vi.fn<(...a: any[]) => Promise<any[]>>(),
}))

vi.mock('next/headers', () => ({ headers: h.headers }))
vi.mock('@/lib/auth/principal', async io => ({
  ...await io<typeof import('@/lib/auth/principal')>(),
  getPrincipal: (...a: any[]) => h.getPrincipal(...a),
}))
vi.mock('@/lib/api-tokens/creatorCheck', () => ({
  creatorStillHolds: (...a: any[]) => h.creator(...a),
  creatorStillHoldsPermission: async () => true,
}))
vi.mock('@/lib/tenant/infraScope', () => ({ getTenantInfrastructureScope: async () => ({ kind: 'provider' }) }))
vi.mock('@/lib/tenant', () => ({
  DEFAULT_TENANT_ID: 'default',
  getCurrentTenantId: async () => 'default',
  getTenantConnectionIds: async () => new Set(['c1', 'c2']),
  requireProviderTenant: async () => null,
}))
vi.mock('@/lib/rbac', () => ({
  checkPermission: (...a: any[]) => h.checkPermission(...a),
  grantsPermission: (set: Set<string>, p: string) => set.has(p),
  PERMISSIONS: { ADMIN_SETTINGS: 'admin.settings', ADMIN_SETTINGS_VIEW: 'admin.settings.view', VM_VIEW: 'vm.view' },
}))
vi.mock('@/lib/vdc', () => ({
  listVdcs: (...a: any[]) => h.listVdcs(...a),
  getVdcById: (...a: any[]) => h.getVdcById(...a),
  createVdc: vi.fn(), updateVdc: vi.fn(), deleteVdc: vi.fn(),
}))
vi.mock('@/lib/vdc/evpnZones', () => ({
  listEvpnZones: (...a: any[]) => h.listZones(...a),
  getEvpnZone: (...a: any[]) => h.getZone(...a),
  getEvpnZoneStatus: (...a: any[]) => h.zoneStatus(...a),
  createEvpnZone: vi.fn(), updateEvpnZone: vi.fn(), deleteEvpnZone: vi.fn(),
}))
vi.mock('@/lib/vdc/move/status', () => ({ listMoves: (...a: any[]) => h.listMoves(...a) }))
vi.mock('@/lib/audit', () => ({ audit: (...a: any[]) => h.audit(...a) }))

import { GET as VDCS_LIST } from '@/app/api/v1/admin/vdcs/route'
import { GET as VDC_GET } from '@/app/api/v1/admin/vdcs/[id]/route'
import { GET as ZONES_LIST } from '@/app/api/v1/admin/evpn-zones/route'
import { GET as ZONE_GET } from '@/app/api/v1/admin/evpn-zones/[id]/route'
import { GET as MOVES_LIST } from '@/app/api/v1/vdc/moves/route'

const token = (connectionIds: string[] | null, scopes = ['vdcs:read']) => ({
  kind: 'token', tokenId: 'tok-1', tenantId: 'default', creatorUserId: 'u1', connectionIds, scopes,
  permissions: new Set(['admin.settings.view', 'vm.view', 'sdn.vnet.view']),
})

function tokenRequest(entry: string, path: string) {
  h.headers.mockResolvedValue(new Headers({
    authorization: 'Bearer pxc_abcdefgh_secret', 'x-pxc-method': 'GET', 'x-pxc-path': path, 'x-pxc-entry': entry,
  }))
  const req = new Request(`http://test.local${path}`) as any
  req.nextUrl = new URL(`http://test.local${path}`)
  return req
}

const VDC_C1 = { id: 'v1', connectionId: 'c1' }
const VDC_C2 = { id: 'v2', connectionId: 'c2' }
const ZONE_C1 = { id: 'z1', members: [{ connectionId: 'c1' }] }
const ZONE_C1_C2 = { id: 'z2', members: [{ connectionId: 'c1' }, { connectionId: 'c2' }] }
const ids = async (res: Response) => (await res.json()).data.map((x: any) => x.id)

beforeEach(() => {
  vi.clearAllMocks()
  h.getPrincipal.mockResolvedValue({ ok: true, principal: token(['c1']) })
  h.checkPermission.mockResolvedValue(null)
  h.creator.mockResolvedValue(true)
  h.listVdcs.mockResolvedValue([VDC_C1, VDC_C2])
  h.getVdcById.mockImplementation(async (id: string) => [VDC_C1, VDC_C2].find(v => v.id === id) ?? null)
  h.listZones.mockResolvedValue([ZONE_C1, ZONE_C1_C2])
  h.getZone.mockImplementation(async (id: string) => [ZONE_C1, ZONE_C1_C2].find(z => z.id === id))
  h.zoneStatus.mockResolvedValue([])
  h.listMoves.mockResolvedValue([
    { id: 'm1', sourceConnectionId: 'c1', targetConnectionId: 'c1' },
    { id: 'm2', sourceConnectionId: 'c1', targetConnectionId: 'c2' },
  ])
})

describe('vDCs through a vdcs:read token restricted to c1', () => {
  it('lists the vDCs on c1 only, under admin.settings.view', async () => {
    const res = await VDCS_LIST(tokenRequest('admin-vdcs-list', '/api/v1/admin/vdcs'), {} as any)
    expect(res.status).toBe(200)
    expect(await ids(res)).toEqual(['v1'])
    expect(h.checkPermission).toHaveBeenCalledWith('admin.settings.view')
    expect(h.creator).toHaveBeenCalledWith(expect.objectContaining({ tokenId: 'tok-1', connectionIds: ['c1'] }), 'vdcs:read')
  })

  it('lists every vDC of the tenant connections for an unrestricted token', async () => {
    h.getPrincipal.mockResolvedValue({ ok: true, principal: token(null) })
    expect(await ids(await VDCS_LIST(tokenRequest('admin-vdcs-list', '/api/v1/admin/vdcs'), {} as any))).toEqual(['v1', 'v2'])
  })

  it('answers 404 for a vDC on another connection, 200 for its own', async () => {
    const outside = await VDC_GET(tokenRequest('admin-vdc-get', '/api/v1/admin/vdcs/v2'), { params: Promise.resolve({ id: 'v2' }) })
    expect(outside.status).toBe(404)
    expect(await outside.json()).toEqual({ error: 'vDC not found' })
    const inside = await VDC_GET(tokenRequest('admin-vdc-get', '/api/v1/admin/vdcs/v1'), { params: Promise.resolve({ id: 'v1' }) })
    expect(inside.status).toBe(200)
    expect((await inside.json()).data.id).toBe('v1')
  })

  it('refuses a token whose creator lost the admin read, before any lookup', async () => {
    h.creator.mockResolvedValue(false)
    const res = await VDCS_LIST(tokenRequest('admin-vdcs-list', '/api/v1/admin/vdcs'), {} as any)
    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Token creator no longer holds this right', scope: 'vdcs:read' })
    expect(h.listVdcs).not.toHaveBeenCalled()
  })
})

describe('EVPN zones through a vdcs:read token restricted to c1', () => {
  it('lists the zones it fully covers', async () => {
    expect(await ids(await ZONES_LIST(tokenRequest('evpn-zones-list', '/api/v1/admin/evpn-zones'), {} as any))).toEqual(['z1'])
    expect(h.checkPermission).toHaveBeenCalledWith('admin.settings.view')
  })

  it('answers 404 for a zone reaching c2 without asking any cluster for its state', async () => {
    const res = await ZONE_GET(tokenRequest('evpn-zone-get', '/api/v1/admin/evpn-zones/z2'), { params: Promise.resolve({ id: 'z2' }) })
    expect(res.status).toBe(404)
    expect(h.zoneStatus).not.toHaveBeenCalled()
    const own = await ZONE_GET(tokenRequest('evpn-zone-get', '/api/v1/admin/evpn-zones/z1'), { params: Promise.resolve({ id: 'z1' }) })
    expect(own.status).toBe(200)
    expect(h.zoneStatus).toHaveBeenCalledWith('z1')
  })
})

describe('moves between vDCs through a vms:read token restricted to c1', () => {
  it('lists the moves whose both ends are inside the perimeter, with no creator check for vms:read', async () => {
    h.getPrincipal.mockResolvedValue({ ok: true, principal: token(['c1'], ['vms:read']) })
    expect(await ids(await MOVES_LIST(tokenRequest('vdc-moves-list', '/api/v1/vdc/moves'), {} as any))).toEqual(['m1'])
    expect(h.checkPermission).toHaveBeenCalledWith('vm.view')
    expect(h.creator).not.toHaveBeenCalled()
  })
})
