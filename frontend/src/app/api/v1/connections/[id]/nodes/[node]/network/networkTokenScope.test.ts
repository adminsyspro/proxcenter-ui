/**
 * Node network interfaces and the SDN apply are cluster-level objects: a vDC
 * tenant (iaas) token is refused before the handler, a provider token inside
 * its perimeter reaches them and is judged by the handler's own check. Real
 * routes, real guard; the principal, tenant, RBAC and Proxmox are stubbed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  headers: vi.fn<() => Promise<Headers>>(),
  getPrincipal: vi.fn<(...a: any[]) => Promise<any>>(),
  infra: vi.fn<(...a: any[]) => Promise<any>>(),
  checkPermission: vi.fn<(...a: any[]) => Promise<Response | null>>(),
  creator: vi.fn<(...a: any[]) => Promise<boolean>>(),
  audit: vi.fn<(...a: any[]) => Promise<string>>(),
  pveFetch: vi.fn<(...a: any[]) => Promise<any>>(),
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
  getCurrentTenantId: async () => 'default',
  getTenantConnectionIds: async () => new Set(['c1', 'c2']),
  DEFAULT_TENANT_ID: 'default',
}))
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionById: async (id: string) => ({ id, baseUrl: 'https://pve', apiToken: 't' }) }))
vi.mock('@/lib/proxmox/client', () => ({ pveFetch: (...a: any[]) => h.pveFetch(...a) }))
vi.mock('@/lib/rbac', () => ({
  checkPermission: (...a: any[]) => h.checkPermission(...a),
  buildNodeResourceId: (conn: string, node: string) => `${conn}:${node}`,
  PERMISSIONS: { NODE_NETWORK: 'node.network', CONNECTION_MANAGE: 'connection.manage' },
}))
vi.mock('@/lib/audit', () => ({ audit: (...a: any[]) => h.audit(...a) }))

import { POST } from './route'
import { POST as SDN_APPLY } from '../../../sdn/apply/route'

const TOKEN = {
  kind: 'token', tokenId: 'tok-a', tenantId: 'default', creatorUserId: 'u-a', connectionIds: ['c1'],
  scopes: ['network:write'], permissions: new Set(['node.view', 'connection.view', 'node.network', 'connection.manage']),
}

function tokenRequest(path: string, entry: string, body?: unknown) {
  h.headers.mockResolvedValue(new Headers({
    authorization: 'Bearer pxc_abcdefgh_secret', 'x-pxc-method': 'POST', 'x-pxc-path': path, 'x-pxc-entry': entry,
  }))
  return new Request(`http://test.local${path}`, {
    method: 'POST',
    ...(body ? { body: JSON.stringify(body), headers: { 'content-type': 'application/json' } } : {}),
  })
}

const createIface = (conn: string) => POST(
  tokenRequest(`/api/v1/connections/${conn}/nodes/n1/network`, 'node-network-create', { iface: 'vmbr9', type: 'bridge' }),
  { params: Promise.resolve({ id: conn, node: 'n1' }) },
)
const applySdn = (conn: string) => SDN_APPLY(
  tokenRequest(`/api/v1/connections/${conn}/sdn/apply`, 'sdn-apply'),
  { params: Promise.resolve({ id: conn }) },
)

beforeEach(() => {
  vi.clearAllMocks()
  h.getPrincipal.mockResolvedValue({ ok: true, principal: TOKEN })
  h.infra.mockResolvedValue({ kind: 'provider' })
  h.creator.mockResolvedValue(true)
  h.checkPermission.mockResolvedValue(null)
  h.audit.mockResolvedValue('audit-1')
  h.pveFetch.mockResolvedValue('UPID:n1:0000:sdn')
})

describe('node network and SDN apply with an API token', () => {
  it.each([['node-network-create', createIface], ['sdn-apply', applySdn]] as const)(
    '%s from a vDC tenant token: 403 cluster object, Proxmox untouched',
    async (_id, call) => {
      h.getPrincipal.mockResolvedValue({ ok: true, principal: { ...TOKEN, tenantId: 'tenant-a' } })
      h.infra.mockResolvedValue({ kind: 'iaas' })

      const res = await call('c1')

      expect(res.status).toBe(403)
      expect(await res.json()).toEqual({ error: 'Cluster-level object not available to a vDC tenant token' })
      expect(h.checkPermission).not.toHaveBeenCalled()
      expect(h.pveFetch).not.toHaveBeenCalled()
    },
  )

  it.each([['node-network-create', createIface], ['sdn-apply', applySdn]] as const)(
    '%s on a connection outside the token perimeter: 403',
    async (_id, call) => {
      const res = await call('c2')

      expect(res.status).toBe(403)
      expect(await res.json()).toEqual({ error: 'Connection not in token scope', connection: 'c2' })
      expect(h.pveFetch).not.toHaveBeenCalled()
    },
  )

  it('node-network-create inside the perimeter is judged on the node and reaches Proxmox', async () => {
    const res = await createIface('c1')

    expect(res.status).toBe(200)
    expect(h.checkPermission).toHaveBeenCalledWith('node.network', 'node', 'c1:n1')
    expect(h.pveFetch).toHaveBeenCalledWith(expect.objectContaining({ id: 'c1' }), '/nodes/n1/network', expect.objectContaining({ method: 'POST' }))
  })

  it('sdn-apply inside the perimeter answers the Proxmox UPID', async () => {
    const res = await applySdn('c1')

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ data: { upid: 'UPID:n1:0000:sdn' } })
    expect(h.checkPermission).toHaveBeenCalledWith('connection.manage', 'connection', 'c1')
  })
})
