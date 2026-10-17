/**
 * Auto-HA settings are stored per connection while their handlers check
 * node.manage without a resource. An API token limited to connection c1 must
 * not rewrite (or apply) the Auto-HA of c2: the guard refuses it on the path
 * connection, and the handlers judge a token on ("connection", id). A session
 * keeps the resource-less check. Real route, real guard, real perimeter
 * resolution; only the principal, the tenant, settings, RBAC and Proxmox are
 * stubbed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  headersMock, getPrincipalMock, infraMock, checkPermissionMock, creatorMock, auditMock, getSettingMock, setSettingMock, pveFetchMock,
} = vi.hoisted(() => ({
  headersMock: vi.fn<() => Promise<Headers>>(),
  getPrincipalMock: vi.fn<(...a: any[]) => Promise<any>>(),
  infraMock: vi.fn<(...a: any[]) => Promise<any>>(),
  checkPermissionMock: vi.fn<(...a: any[]) => Promise<Response | null>>(),
  creatorMock: vi.fn<(...a: any[]) => Promise<boolean>>(),
  auditMock: vi.fn<(...a: any[]) => Promise<string>>(),
  getSettingMock: vi.fn<(...a: any[]) => Promise<any>>(),
  setSettingMock: vi.fn<(...a: any[]) => Promise<void>>(),
  pveFetchMock: vi.fn<(...a: any[]) => Promise<any>>(),
}))

vi.mock('next/headers', () => ({ headers: headersMock }))
vi.mock('@/lib/auth/principal', async io => ({
  ...await io<typeof import('@/lib/auth/principal')>(),
  getPrincipal: (...a: any[]) => getPrincipalMock(...a),
}))
vi.mock('@/lib/api-tokens/creatorCheck', () => ({ creatorStillHolds: (...a: any[]) => creatorMock(...a) }))
vi.mock('@/lib/tenant/infraScope', async io => ({
  ...await io<typeof import('@/lib/tenant/infraScope')>(),
  getTenantInfrastructureScope: (...a: any[]) => infraMock(...a),
}))
vi.mock('@/lib/tenant', () => ({
  getCurrentTenantId: async () => 'default',
  getTenantConnectionIds: async () => new Set(['c1', 'c2']),
  DEFAULT_TENANT_ID: 'default',
}))
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionById: async (id: string) => ({ id, baseUrl: 'https://pve', apiToken: 't' }) }))
vi.mock('@/lib/proxmox/client', () => ({ pveFetch: (...a: any[]) => pveFetchMock(...a) }))
vi.mock('@/lib/db/settings', () => ({
  getSetting: (...a: any[]) => getSettingMock(...a),
  setSetting: (...a: any[]) => setSettingMock(...a),
}))
vi.mock('@/lib/rbac', () => ({
  checkPermission: (...a: any[]) => checkPermissionMock(...a),
  PERMISSIONS: { NODE_VIEW: 'node.view', NODE_MANAGE: 'node.manage' },
}))
vi.mock('@/lib/audit', () => ({ audit: (...a: any[]) => auditMock(...a) }))

import { PUT } from './route'
import { POST as SYNC } from './sync/route'

const TOKEN = {
  kind: 'token', tokenId: 'tok-a', tenantId: 'default', creatorUserId: 'u-a',
  connectionIds: ['c1'], scopes: ['ha:write'], permissions: new Set(['node.view', 'connection.view', 'node.manage', 'connection.manage']),
}
const SESSION = { kind: 'session', userId: 'u-1', tenantId: 'default' }

function tokenRequest(method: 'PUT' | 'POST', path: string, entry: string) {
  headersMock.mockResolvedValue(new Headers({
    authorization: 'Bearer pxc_abcdefgh_secret', 'x-pxc-method': method, 'x-pxc-path': path, 'x-pxc-entry': entry,
  }))
  return new Request(`http://test.local${path}`, {
    method,
    ...(method === 'PUT' ? { body: JSON.stringify({ enabled: true }), headers: { 'content-type': 'application/json' } } : {}),
  })
}

const params = (id: string) => ({ params: Promise.resolve({ id }) })

beforeEach(() => {
  vi.clearAllMocks()
  getPrincipalMock.mockResolvedValue({ ok: true, principal: TOKEN })
  infraMock.mockResolvedValue({ kind: 'provider' })
  creatorMock.mockResolvedValue(true)
  checkPermissionMock.mockResolvedValue(null)
  auditMock.mockResolvedValue('audit-1')
  getSettingMock.mockResolvedValue({ enabled: true, state: 'started' })
  pveFetchMock.mockResolvedValue([])
})

describe('Auto-HA writes with an API token limited to c1', () => {
  it('PUT auto-ha of c2: 403, nothing stored', async () => {
    const res = await PUT(tokenRequest('PUT', '/api/v1/connections/c2/ha/auto-ha', 'ha-auto-update'), params('c2'))

    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Connection not in token scope', connection: 'c2' })
    expect(checkPermissionMock).not.toHaveBeenCalled()
    expect(setSettingMock).not.toHaveBeenCalled()
  })

  it('POST auto-ha/sync of c2: 403, Proxmox untouched', async () => {
    const res = await SYNC(tokenRequest('POST', '/api/v1/connections/c2/ha/auto-ha/sync', 'ha-auto-sync'), params('c2'))

    expect(res.status).toBe(403)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('PUT auto-ha of c1 is judged on the connection, and stored', async () => {
    const res = await PUT(tokenRequest('PUT', '/api/v1/connections/c1/ha/auto-ha', 'ha-auto-update'), params('c1'))

    expect(res.status).toBe(200)
    expect(checkPermissionMock).toHaveBeenCalledWith('node.manage', 'connection', 'c1')
    expect(setSettingMock).toHaveBeenCalledWith('auto_ha:c1', 'default', expect.objectContaining({ enabled: true }))
  })

  it('POST auto-ha/sync of c1 is judged on the connection', async () => {
    const res = await SYNC(tokenRequest('POST', '/api/v1/connections/c1/ha/auto-ha/sync', 'ha-auto-sync'), params('c1'))

    expect(res.status).toBe(200)
    expect(checkPermissionMock).toHaveBeenCalledWith('node.manage', 'connection', 'c1')
  })

  it('a session keeps the resource-less node.manage check', async () => {
    getPrincipalMock.mockResolvedValue({ ok: true, principal: SESSION })
    const req = new Request('http://test.local/api/v1/connections/c2/ha/auto-ha', {
      method: 'PUT', body: JSON.stringify({ enabled: false }), headers: { 'content-type': 'application/json' },
    })

    const res = await PUT(req, params('c2'))

    expect(res.status).toBe(200)
    expect(checkPermissionMock).toHaveBeenCalledWith('node.manage')
    expect(await SYNC(new Request('http://test.local/x', { method: 'POST' }), params('c2'))).toHaveProperty('status', 200)
    expect(checkPermissionMock).toHaveBeenLastCalledWith('node.manage')
  })
})
