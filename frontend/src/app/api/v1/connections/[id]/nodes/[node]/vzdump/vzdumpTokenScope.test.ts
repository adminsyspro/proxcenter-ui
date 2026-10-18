/**
 * Review focus 1 of the API token write mode: a vDC tenant token naming, in
 * the vzdump BODY, a guest of another tenant on the same provider connection
 * must be refused before the handler runs. Real route, real guard (entry
 * vm-backup-now, guestScope on the body `vmid`), real vDC check; only the
 * principal, the perimeter, the tenant scope and Proxmox are stubbed.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const {
  headersMock, getPrincipalMock, visibleMock, infraMock, pveFetchMock, checkPermissionMock, creatorMock, auditMock,
} = vi.hoisted(() => ({
  headersMock: vi.fn<() => Promise<Headers>>(),
  getPrincipalMock: vi.fn<(...a: any[]) => Promise<any>>(),
  visibleMock: vi.fn<(...a: any[]) => Promise<Set<string>>>(),
  infraMock: vi.fn<(...a: any[]) => Promise<any>>(),
  pveFetchMock: vi.fn<(...a: any[]) => Promise<any>>(),
  checkPermissionMock: vi.fn<(...a: any[]) => Promise<Response | null>>(),
  creatorMock: vi.fn<(...a: any[]) => Promise<boolean>>(),
  auditMock: vi.fn<(...a: any[]) => Promise<string>>(),
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
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionById: async () => ({ id: 'conn-1', baseUrl: 'https://pve', apiToken: 't' }) }))
vi.mock('@/lib/proxmox/client', () => ({ pveFetch: (...a: any[]) => pveFetchMock(...a) }))
vi.mock('@/lib/rbac', () => ({
  checkPermission: (...a: any[]) => checkPermissionMock(...a),
  buildNodeResourceId: (id: string, node: string) => `${id}:${node}`,
  buildStorageResourceId: (id: string, storage: string) => `${id}:${storage}`,
  PERMISSIONS: { VM_BACKUP: 'vm.backup' },
}))
vi.mock('@/lib/tenant', () => ({ getCurrentTenantId: async () => 'tenant-a', DEFAULT_TENANT_ID: 'default' }))
vi.mock('@/lib/audit', () => ({ audit: (...a: any[]) => auditMock(...a) }))

import { POST } from './route'

const PATH = '/api/v1/connections/conn-1/nodes/pve1/vzdump'
const TOKEN = {
  kind: 'token', tokenId: 'tok-a', tenantId: 'tenant-a', creatorUserId: 'u-a',
  connectionIds: null, scopes: ['backups:write'], permissions: new Set(['vm.backup']),
}

/** Tenant A's vDC on the provider connection: node pve1, pool pool-a, storage ceph-a. */
const VDC_SCOPE = {
  connectionIds: new Set(['conn-1']),
  nodesByConnection: new Map([['conn-1', new Set(['pve1'])]]),
  poolsByConnection: new Map([['conn-1', new Set(['pool-a'])]]),
  storagesByConnection: new Map([['conn-1', new Set(['ceph-a'])]]),
  writableStoragesByConnection: new Map([['conn-1', new Set(['ceph-a'])]]),
  isoLibrariesByConnection: new Map(),
}

/** Guest 100 is tenant A's; guest 200 sits on the same node in tenant B's pool. */
const GUESTS = [
  { vmid: 100, type: 'qemu', node: 'pve1', pool: 'pool-a' },
  { vmid: 200, type: 'qemu', node: 'pve1', pool: 'pool-b' },
]

function vzdump(body: Record<string, unknown>) {
  const req = new Request(`http://test.local${PATH}`, {
    method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
  })
  return POST(req, { params: Promise.resolve({ id: 'conn-1', node: 'pve1' }) })
}

const vzdumpCalls = () => pveFetchMock.mock.calls.filter(([, path]) => String(path).endsWith('/vzdump'))

beforeEach(() => {
  vi.clearAllMocks()
  headersMock.mockResolvedValue(new Headers({
    authorization: 'Bearer pxc_abcdefgh_secret',
    'x-pxc-method': 'POST',
    'x-pxc-path': PATH,
    'x-pxc-entry': 'vm-backup-now',
  }))
  getPrincipalMock.mockResolvedValue({ ok: true, principal: TOKEN })
  visibleMock.mockResolvedValue(new Set(['conn-1']))
  infraMock.mockResolvedValue({ kind: 'iaas', vdcScope: VDC_SCOPE })
  creatorMock.mockResolvedValue(true)
  checkPermissionMock.mockResolvedValue(null)
  auditMock.mockResolvedValue('audit-1')
  pveFetchMock.mockImplementation(async (_conn: unknown, path: string) =>
    path === '/cluster/resources?type=vm' ? GUESTS : 'UPID:pve1:0000ABCD:00001234:6A000000:vzdump:100:root@pam:')
})

describe('POST vzdump with a vDC tenant API token', () => {
  it('403 for a body vmid of another tenant, before the handler runs', async () => {
    const res = await vzdump({ vmid: 200, storage: 'ceph-a' })

    expect(res.status).toBe(403)
    expect(await res.json()).toEqual({ error: 'Guest outside your vDC scope' })
    expect(checkPermissionMock).not.toHaveBeenCalled()
    expect(vzdumpCalls()).toEqual([])
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
      action: 'apitoken.denied', details: expect.objectContaining({ entry: 'vm-backup-now', reason: 'Guest outside your vDC scope' }),
    }))
  })

  it('403 when a comma-separated vmid list smuggles a foreign guest next to an own one', async () => {
    const res = await vzdump({ vmid: '100,200', storage: 'ceph-a' })

    expect(res.status).toBe(403)
    expect(vzdumpCalls()).toEqual([])
  })

  it('backs up a guest of its own vDC, through the handler', async () => {
    const res = await vzdump({ vmid: 100, storage: 'ceph-a' })

    expect(res.status).toBe(200)
    expect(checkPermissionMock).toHaveBeenCalledWith('vm.backup', 'node', 'conn-1:pve1')
    expect(vzdumpCalls()).toHaveLength(1)
    expect(new URLSearchParams(vzdumpCalls()[0][2].body).get('vmid')).toBe('100')
  })
})
