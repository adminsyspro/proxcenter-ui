/**
 * The vDC VNet routes check sdn.vnet.* without a resource and resolve the vDC
 * connection themselves (perimeter "handler"). An API token reaches the vDCs
 * of its own tenant only (404 otherwise, like a session of another tenant),
 * on a connection inside its perimeter, and is judged on that connection; a
 * session keeps the resource-less check. Real routes, real guard, real
 * perimeter resolution; the principal, tenant, DB rows, RBAC and the VNet
 * library are stubbed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  headers: vi.fn<() => Promise<Headers>>(),
  currentTenant: vi.fn<() => Promise<string>>(),
  getPrincipal: vi.fn<(...a: any[]) => Promise<any>>(),
  infra: vi.fn<(...a: any[]) => Promise<any>>(),
  checkPermission: vi.fn<(...a: any[]) => Promise<Response | null>>(),
  creator: vi.fn<(...a: any[]) => Promise<boolean>>(),
  audit: vi.fn<(...a: any[]) => Promise<string>>(),
  vdcFindUnique: vi.fn<(...a: any[]) => Promise<any>>(),
  vnetFindFirst: vi.fn<(...a: any[]) => Promise<any>>(),
  listVnets: vi.fn<(...a: any[]) => Promise<any[]>>(),
  createVnet: vi.fn<(...a: any[]) => Promise<any>>(),
  updateVnet: vi.fn<(...a: any[]) => Promise<any>>(),
  deleteVnet: vi.fn<(...a: any[]) => Promise<any>>(),
}))

vi.mock('next/headers', () => ({ headers: h.headers }))
vi.mock('@/lib/auth/principal', async io => ({
  ...await io<typeof import('@/lib/auth/principal')>(),
  getPrincipal: (...a: any[]) => h.getPrincipal(...a),
}))
vi.mock('@/lib/api-tokens/creatorCheck', () => ({ creatorStillHolds: (...a: any[]) => h.creator(...a) }))
vi.mock('@/lib/tenant/infraScope', async io => ({
  ...await io<typeof import('@/lib/tenant/infraScope')>(),
  getTenantInfrastructureScope: (...a: any[]) => h.infra(...a),
}))
vi.mock('@/lib/tenant', () => ({
  getCurrentTenantId: () => h.currentTenant(),
  getTenantConnectionIds: async () => new Set(['c1', 'c2']),
  DEFAULT_TENANT_ID: 'default',
}))
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    vdc: { findUnique: (...a: any[]) => h.vdcFindUnique(...a) },
    vdcVnet: { findFirst: (...a: any[]) => h.vnetFindFirst(...a) },
  },
}))
vi.mock('@/lib/rbac', () => ({
  checkPermission: (...a: any[]) => h.checkPermission(...a),
  PERMISSIONS: { SDN_VNET_VIEW: 'sdn.vnet.view', SDN_VNET_CREATE: 'sdn.vnet.create', SDN_VNET_EDIT: 'sdn.vnet.edit', SDN_VNET_DELETE: 'sdn.vnet.delete' },
}))
vi.mock('@/lib/vdc/vnets', () => ({
  listVnetsForTenant: (...a: any[]) => h.listVnets(...a),
  createVnetForTenant: (...a: any[]) => h.createVnet(...a),
  updateVnetForTenant: (...a: any[]) => h.updateVnet(...a),
  deleteVnetForTenant: (...a: any[]) => h.deleteVnet(...a),
}))
vi.mock('@/lib/vdc/ipam', () => ({ getSubnetUsage: async () => ({ used: 0, usable: 0 }) }))
vi.mock('@/lib/audit', () => ({ audit: (...a: any[]) => h.audit(...a) }))

import { GET as LIST, POST as CREATE } from './route'
import { DELETE, GET, PUT } from './[pveName]/route'

const TOKEN_A = {
  kind: 'token', tokenId: 'tok-a', tenantId: 'tenant-a', creatorUserId: 'u-a', connectionIds: null,
  scopes: ['network:write'], permissions: new Set(['node.view', 'connection.view', 'node.network', 'connection.manage', 'sdn.vnet.view', 'sdn.vnet.create', 'sdn.vnet.edit', 'sdn.vnet.delete']),
}
const SESSION = { kind: 'session', userId: 'u-1', tenantId: 'tenant-a', connectionIds: null }
const VDC_A = { id: 'vdc-a', tenantId: 'tenant-a', connectionId: 'c1' }
const VDC_B = { id: 'vdc-b', tenantId: 'tenant-b', connectionId: 'c1' }

type Method = 'GET' | 'POST' | 'PUT' | 'DELETE'
const ENTRY: Record<string, string> = {
  'GET list': 'vdc-vnets-list', 'POST list': 'vdc-vnet-create',
  'GET item': 'vdc-vnet-get', 'PUT item': 'vdc-vnet-update', 'DELETE item': 'vdc-vnet-delete',
}

function tokenRequest(method: Method, vdcId: string, item: boolean) {
  const path = `/api/v1/vdcs/${vdcId}/vnets${item ? '/lan' : ''}`
  h.headers.mockResolvedValue(new Headers({
    authorization: 'Bearer pxc_abcdefgh_secret', 'x-pxc-method': method, 'x-pxc-path': path,
    'x-pxc-entry': ENTRY[`${method} ${item ? 'item' : 'list'}`],
  }))
  const withBody = method === 'POST' || method === 'PUT'
  return new Request(`http://test.local${path}`, {
    method,
    ...(withBody ? { body: JSON.stringify({ displayName: 'lan', description: 'x' }), headers: { 'content-type': 'application/json' } } : {}),
  })
}

const listParams = (id: string) => ({ params: Promise.resolve({ id }) })
const itemParams = (id: string) => ({ params: Promise.resolve({ id, pveName: 'lan' }) })

const CALLS = [
  ['GET list', (vdc: string) => LIST(tokenRequest('GET', vdc, false), listParams(vdc))],
  ['POST list', (vdc: string) => CREATE(tokenRequest('POST', vdc, false), listParams(vdc))],
  ['GET item', (vdc: string) => GET(tokenRequest('GET', vdc, true), itemParams(vdc))],
  ['PUT item', (vdc: string) => PUT(tokenRequest('PUT', vdc, true), itemParams(vdc))],
  ['DELETE item', (vdc: string) => DELETE(tokenRequest('DELETE', vdc, true), itemParams(vdc))],
] as const

beforeEach(() => {
  vi.clearAllMocks()
  h.getPrincipal.mockResolvedValue({ ok: true, principal: TOKEN_A })
  h.currentTenant.mockResolvedValue('tenant-a')
  h.infra.mockResolvedValue({ kind: 'iaas' })
  h.creator.mockResolvedValue(true)
  h.checkPermission.mockResolvedValue(null)
  h.audit.mockResolvedValue('audit-1')
  h.vdcFindUnique.mockImplementation(async ({ where }: any) => [VDC_A, VDC_B].find(v => v.id === where.id) ?? null)
  h.vnetFindFirst.mockResolvedValue(null)
  h.listVnets.mockResolvedValue([])
  h.createVnet.mockResolvedValue({ id: 'vnet-1' })
  h.updateVnet.mockResolvedValue({ id: 'vnet-1' })
  h.deleteVnet.mockResolvedValue({ deleted: true })
})

describe('vDC VNets with an API token of tenant A', () => {
  it.each(CALLS)('%s on a vDC of tenant B: 404, nothing read or written', async (_name, call) => {
    const res = await call('vdc-b')

    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'vDC not found' })
    expect(h.checkPermission).not.toHaveBeenCalled()
    for (const lib of [h.listVnets, h.createVnet, h.updateVnet, h.deleteVnet, h.vnetFindFirst]) expect(lib).not.toHaveBeenCalled()
  })

  it.each(CALLS)('%s on an unknown vDC: 404', async (_name, call) => {
    expect((await call('vdc-none')).status).toBe(404)
  })

  it.each(CALLS)('%s when the vDC connection is outside the token perimeter: 403', async (_name, call) => {
    h.getPrincipal.mockResolvedValue({ ok: true, principal: { ...TOKEN_A, connectionIds: ['c2'] } })

    const res = await call('vdc-a')

    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Connection not in token scope', connection: 'c1' })
    expect(h.checkPermission).not.toHaveBeenCalled()
  })

  it('a provider token on a tenant vDC reads its VNet list, as a provider session does', async () => {
    h.getPrincipal.mockResolvedValue({ ok: true, principal: { ...TOKEN_A, tenantId: 'default' } })
    h.infra.mockResolvedValue({ kind: 'provider' })

    const res = await LIST(tokenRequest('GET', 'vdc-b', false), listParams('vdc-b'))

    expect(res.status).toBe(200)
    expect(h.checkPermission).toHaveBeenCalledWith('sdn.vnet.view', 'connection', 'c1')
  })

  it.each(CALLS)('%s when the vDC lookup fails: an error, no library call', async (_name, call) => {
    h.vdcFindUnique.mockRejectedValue(new Error('database unavailable'))

    const res = await call('vdc-a')

    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(h.checkPermission).not.toHaveBeenCalled()
    for (const lib of [h.listVnets, h.createVnet, h.updateVnet, h.deleteVnet, h.vnetFindFirst]) expect(lib).not.toHaveBeenCalled()
  })

  it('creates on its own vDC, judged on the vDC connection, with no creating user', async () => {
    const res = await CREATE(tokenRequest('POST', 'vdc-a', false), listParams('vdc-a'))

    expect(res.status).toBe(201)
    expect(h.checkPermission).toHaveBeenCalledWith('sdn.vnet.create', 'connection', 'c1')
    expect(h.createVnet).toHaveBeenCalledWith(expect.objectContaining({ vdcId: 'vdc-a', tenantId: 'tenant-a', createdBy: null }))
  })

  it.each([
    ['PUT', 'sdn.vnet.edit', () => PUT(tokenRequest('PUT', 'vdc-a', true), itemParams('vdc-a'))],
    ['DELETE', 'sdn.vnet.delete', () => DELETE(tokenRequest('DELETE', 'vdc-a', true), itemParams('vdc-a'))],
    ['GET', 'sdn.vnet.view', () => GET(tokenRequest('GET', 'vdc-a', true), itemParams('vdc-a'))],
  ] as const)('%s on its own vDC is judged on the vDC connection', async (_m, permission, call) => {
    await call()

    expect(h.checkPermission).toHaveBeenCalledWith(permission, 'connection', 'c1')
  })
})

describe('vDC VNets with a provider token, as with a provider session', () => {
  beforeEach(() => {
    h.getPrincipal.mockResolvedValue({ ok: true, principal: { ...TOKEN_A, tenantId: 'default' } })
    h.currentTenant.mockResolvedValue('default')
    h.infra.mockResolvedValue({ kind: 'provider' })
    // The library resolves the vDC within the caller's tenant (resolveVdcForVnet).
    const ownVdcOnly = async (vdcId: string, tenantId: string) => {
      if ([VDC_A, VDC_B].find(v => v.id === vdcId)?.tenantId !== tenantId) throw new Error('vDC not found')
      return { id: 'vnet-1' }
    }
    h.updateVnet.mockImplementation(ownVdcOnly)
    h.deleteVnet.mockImplementation(ownVdcOnly)
  })

  it.each([
    ['GET', () => GET(tokenRequest('GET', 'vdc-b', true), itemParams('vdc-b'))],
    ['PUT', () => PUT(tokenRequest('PUT', 'vdc-b', true), itemParams('vdc-b'))],
    ['DELETE', () => DELETE(tokenRequest('DELETE', 'vdc-b', true), itemParams('vdc-b'))],
  ] as const)('%s on a VNet of a tenant vDC: 404, looked up in the provider tenant', async (method, call) => {
    const res = await call()

    expect(res.status).toBe(404)
    if (method === 'GET') {
      expect(h.vnetFindFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { vdcId: 'vdc-b', displayName: 'lan', vdc: { tenantId: 'default' } } }))
    } else {
      expect(method === 'PUT' ? h.updateVnet : h.deleteVnet).toHaveBeenCalledWith('vdc-b', 'default', 'lan', ...(method === 'PUT' ? [expect.anything()] : []))
    }
  })
})

describe('vDC VNets with a session', () => {
  beforeEach(() => {
    h.getPrincipal.mockResolvedValue({ ok: true, principal: SESSION })
  })

  it('keeps the resource-less sdn.vnet.* checks and the session user as creator', async () => {
    const json = (method: string) => ({ method, body: JSON.stringify({ displayName: 'lan' }), headers: { 'content-type': 'application/json' } })

    expect((await CREATE(new Request('http://test.local/x', json('POST')), listParams('vdc-b'))).status).toBe(201)
    expect(h.checkPermission).toHaveBeenLastCalledWith('sdn.vnet.create')
    expect(h.createVnet).toHaveBeenCalledWith(expect.objectContaining({ createdBy: 'u-1' }))

    await LIST(new Request('http://test.local/x'), listParams('vdc-b'))
    expect(h.checkPermission).toHaveBeenLastCalledWith('sdn.vnet.view')
    await PUT(new Request('http://test.local/x', json('PUT')), itemParams('vdc-b'))
    expect(h.checkPermission).toHaveBeenLastCalledWith('sdn.vnet.edit')
    await DELETE(new Request('http://test.local/x', { method: 'DELETE' }), itemParams('vdc-b'))
    expect(h.checkPermission).toHaveBeenLastCalledWith('sdn.vnet.delete')
    await GET(new Request('http://test.local/x'), itemParams('vdc-b'))
    expect(h.checkPermission).toHaveBeenLastCalledWith('sdn.vnet.view')
    expect(h.vdcFindUnique).not.toHaveBeenCalled()
  })
})
