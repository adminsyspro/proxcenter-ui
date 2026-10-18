/**
 * Attaching a PBS datastore rewrites the cluster's storage.cfg: a vDC tenant
 * API token is refused before the handler runs (entry storage-attach-pbs,
 * clusterObject), and the PBS named in the body must sit inside the token
 * perimeter too (secondaryConnections). Real route, real guard; only the
 * principal, the perimeter, the tenant scope, Proxmox and PBS are stubbed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  headersMock, getPrincipalMock, visibleMock, infraMock, checkPermissionMock, creatorMock, auditMock, attachMock,
} = vi.hoisted(() => ({
  headersMock: vi.fn<() => Promise<Headers>>(),
  getPrincipalMock: vi.fn<(...a: any[]) => Promise<any>>(),
  visibleMock: vi.fn<(...a: any[]) => Promise<Set<string>>>(),
  infraMock: vi.fn<(...a: any[]) => Promise<any>>(),
  checkPermissionMock: vi.fn<(...a: any[]) => Promise<Response | null>>(),
  creatorMock: vi.fn<(...a: any[]) => Promise<boolean>>(),
  auditMock: vi.fn<(...a: any[]) => Promise<string>>(),
  attachMock: vi.fn<(...a: any[]) => Promise<any>>(),
}))

vi.mock('next/headers', () => ({ headers: headersMock }))
vi.mock('@/lib/auth/principal', async io => ({
  ...await io<typeof import('@/lib/auth/principal')>(),
  getPrincipal: (...a: any[]) => getPrincipalMock(...a),
}))
vi.mock('@/lib/api-tokens/scope', () => ({ resolveVisibleConnectionIds: (...a: any[]) => visibleMock(...a) }))
vi.mock('@/lib/api-tokens/creatorCheck', () => ({ creatorStillHolds: (...a: any[]) => creatorMock(...a) }))
vi.mock('@/lib/tenant/infraScope', async io => ({
  ...await io<typeof import('@/lib/tenant/infraScope')>(),
  getTenantInfrastructureScope: (...a: any[]) => infraMock(...a),
}))
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionById: async () => ({ id: 'conn-1', name: 'prod', baseUrl: 'https://pve', apiToken: 't' }) }))
vi.mock('@/lib/proxmox/client', () => ({ pveFetch: vi.fn() }))
vi.mock('@/lib/rbac', () => ({
  checkPermission: (...a: any[]) => checkPermissionMock(...a),
  getCurrentRbacInfraScope: vi.fn(),
  getRequestGuestScopePerimeter: vi.fn(),
  PERMISSIONS: { CONNECTION_VIEW: 'connection.view', CONNECTION_MANAGE: 'connection.manage', STORAGE_VIEW: 'storage.view', BACKUP_VIEW: 'backup.view' },
}))
vi.mock('@/lib/tenant', () => ({
  getCurrentTenantId: async () => 'default',
  getSessionPrisma: async () => ({ connection: { findFirst: async () => ({ id: 'pbs-1' }) } }),
  DEFAULT_TENANT_ID: 'default',
}))
vi.mock('@/lib/storage/attachPbsStorage', async io => ({
  ...await io<typeof import('@/lib/storage/attachPbsStorage')>(),
  attachPbsStorage: (...a: any[]) => attachMock(...a),
}))
vi.mock('@/lib/audit', () => ({ audit: (...a: any[]) => auditMock(...a) }))

import { POST } from './route'

const PATH = '/api/v1/connections/conn-1/storage'
const TOKEN = {
  kind: 'token', tokenId: 'tok-a', tenantId: 'default', creatorUserId: 'u-a',
  connectionIds: null, scopes: ['storage:write'], permissions: new Set(['connection.manage', 'backup.view']),
}
const BODY = { type: 'pbs', storage: 'pbs-main', datastore: 'ds1', pbsConnectionId: 'pbs-1' }

function attach(body: Record<string, unknown> = BODY) {
  const req = new Request(`http://test.local${PATH}`, {
    method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
  })
  return POST(req, { params: Promise.resolve({ id: 'conn-1' }) })
}

beforeEach(() => {
  vi.clearAllMocks()
  headersMock.mockResolvedValue(new Headers({
    authorization: 'Bearer pxc_abcdefgh_secret',
    'x-pxc-method': 'POST',
    'x-pxc-path': PATH,
    'x-pxc-entry': 'storage-attach-pbs',
  }))
  getPrincipalMock.mockResolvedValue({ ok: true, principal: TOKEN })
  visibleMock.mockResolvedValue(new Set(['conn-1', 'pbs-1']))
  infraMock.mockResolvedValue({ kind: 'provider' })
  creatorMock.mockResolvedValue(true)
  checkPermissionMock.mockResolvedValue(null)
  auditMock.mockResolvedValue('audit-1')
  attachMock.mockResolvedValue({ storage: 'pbs-main', server: 'pbs.lab', datastore: 'ds1', namespace: '', nodes: [] })
})

describe('POST storage (attach PBS) with an API token', () => {
  it('403 for a vDC tenant token, before the handler runs', async () => {
    infraMock.mockResolvedValue({ kind: 'iaas', vdcScope: {} })

    const res = await attach()

    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Cluster-level object not available to a vDC tenant token' })
    expect(checkPermissionMock).not.toHaveBeenCalled()
    expect(attachMock).not.toHaveBeenCalled()
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
      action: 'apitoken.denied',
      details: expect.objectContaining({ entry: 'storage-attach-pbs', reason: 'Cluster-level object not available to a vDC tenant token' }),
    }))
  })

  it('403 when the body names a PBS outside the token perimeter', async () => {
    visibleMock.mockResolvedValue(new Set(['conn-1']))

    const res = await attach()

    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Connection not in token scope', connection: 'pbs-1' })
    expect(attachMock).not.toHaveBeenCalled()
  })

  it('a provider token inside its perimeter attaches the datastore, with the body intact', async () => {
    const res = await attach()

    expect(res.status).toBe(201)
    expect(checkPermissionMock).toHaveBeenCalledWith('connection.manage', 'connection', 'conn-1')
    expect(checkPermissionMock).toHaveBeenCalledWith('backup.view', 'pbs', 'pbs-1')
    expect(attachMock).toHaveBeenCalledWith(expect.objectContaining({ storage: 'pbs-main', datastore: 'ds1', pbsConnectionId: 'pbs-1' }))
  })
})
