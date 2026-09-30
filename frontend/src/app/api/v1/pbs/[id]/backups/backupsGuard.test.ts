/**
 * Task 18: GET /api/v1/pbs/{id}/backups needs no rewiring beyond the guard
 * export (brief: "Aucun autre changement") -- its connection perimeter is
 * carried by the guard's own layer 1 (the {id} connectionSegment, tested in
 * routeGuard.test.ts) and by checkPermission's existing token branch (layer
 * 2, tested in principalAware.test.ts). This file proves the two things
 * that are specific to wrapping THIS route: a token reaches REAL, non-empty
 * backup data through the unchanged handler, and a session caller's
 * response is byte-for-byte what it was before the guard existed.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

import type { Principal } from '@/lib/auth/principal'
import type { CachedBackup } from '@/lib/cache/pbsBackupCache'

const {
  checkPermissionMock, assertVdcPbsAccessMock, getPbsConnectionByIdMock,
  getPbsConnectionByIdUnscopedMock, getAllBackupsMock, vdcPbsNamespaceFindManyMock,
  cookiesMock, currentPrincipal, getVdcScopeMock,
  pveFetchMock, getConnectionByIdMock, getSessionPrismaMock,
} = vi.hoisted(() => ({
  checkPermissionMock: vi.fn<(...a: any[]) => Promise<Response | null>>(),
  assertVdcPbsAccessMock: vi.fn<(id: string) => Promise<any>>(),
  getPbsConnectionByIdMock: vi.fn<(id: string) => Promise<any>>(),
  getPbsConnectionByIdUnscopedMock: vi.fn<(id: string) => Promise<any>>(),
  getAllBackupsMock: vi.fn<(...a: any[]) => Promise<any>>(),
  vdcPbsNamespaceFindManyMock: vi.fn<(...a: any[]) => Promise<any[]>>(),
  cookiesMock: vi.fn<() => Promise<any>>(),
  currentPrincipal: { value: undefined as Principal | undefined },
  getVdcScopeMock: vi.fn<(...a: any[]) => Promise<any>>(),
  pveFetchMock: vi.fn<(...a: any[]) => Promise<any>>(),
  getConnectionByIdMock: vi.fn<(...a: any[]) => Promise<any>>(),
  getSessionPrismaMock: vi.fn<(...a: any[]) => Promise<any>>(),
}))

// Same pass-through convention as reusedRoutesGuard.test.ts: the guard's own
// mechanics are covered by routeGuard.test.ts.
vi.mock('@/lib/api-tokens/routeGuard', () => ({
  withPublicApiGuard: (_entryId: string, handler: any) => (req: Request, ctx: any) =>
    handler(req, { ...(ctx || {}), principal: currentPrincipal.value }),
}))

vi.mock('next/headers', () => ({ cookies: cookiesMock }))

vi.mock('@/lib/demo/demo-api', () => ({ demoResponse: vi.fn().mockReturnValue(null) }))

vi.mock('@/lib/rbac', () => ({
  checkPermission: checkPermissionMock,
  PERMISSIONS: { BACKUP_VIEW: 'backup.view' },
}))

vi.mock('@/lib/vdc/scope', () => ({
  assertVdcPbsAccess: assertVdcPbsAccessMock,
  getVdcScope: getVdcScopeMock,
}))

vi.mock('@/lib/connections/getConnection', () => ({
  getPbsConnectionById: getPbsConnectionByIdMock,
  getPbsConnectionByIdUnscoped: getPbsConnectionByIdUnscopedMock,
  getConnectionById: getConnectionByIdMock,
}))

vi.mock('@/lib/proxmox/client', () => ({ pveFetch: pveFetchMock }))

vi.mock('@/lib/tenant', () => ({
  getSessionPrisma: getSessionPrismaMock,
  getCurrentTenantId: vi.fn().mockResolvedValue('default'),
}))

vi.mock('@/lib/db/prisma', () => ({
  prisma: { vdcPbsNamespace: { findMany: vdcPbsNamespaceFindManyMock } },
}))

vi.mock('@/lib/cache/pbsBackupCache', () => ({ setCachedPbsBackups: vi.fn() }))

vi.mock('@/lib/backups/pbsSnapshots', () => ({
  fetchAllPbsBackups: vi.fn(),
  getAllBackups: getAllBackupsMock,
}))

import { callRoute, readJson } from '@/__tests__/setup/route-test'
import { buildRestoreRequest, groupBackupsByGuest, planTargets } from '@/lib/backups/bulkRestore'

const CONN = { id: 'pbs-1', baseUrl: 'https://pbs.local:8007', apiToken: 'x' }

function backup(overrides: Partial<CachedBackup> = {}): CachedBackup {
  return {
    id: 'b1',
    datastore: 'store1',
    namespace: '',
    backupType: 'vm',
    backupId: '100',
    vmName: 'web-01',
    backupTime: 1_700_000_000,
    backupTimeFormatted: '2023-11-14',
    backupTimeIso: '2023-11-14T22:13:20.000Z',
    size: 1_073_741_824,
    sizeFormatted: '1.00 GiB',
    files: ['qemu-server.conf'],
    fileCount: 1,
    verification: null,
    verified: true,
    verifiedAt: null,
    protected: false,
    owner: 'root@pam',
    comment: '',
    ...overrides,
  }
}

const TOKEN_PRINCIPAL: Principal = {
  kind: 'token',
  tokenId: 'tok_1',
  tenantId: 'default',
  permissions: new Set(['backup.view']),
  connectionIds: ['pbs-1'],
  scopes: ['backups:read'],
}

beforeEach(() => {
  vi.clearAllMocks()
  currentPrincipal.value = undefined
  checkPermissionMock.mockResolvedValue(null)
  assertVdcPbsAccessMock.mockResolvedValue({ kind: 'admin' })
  getPbsConnectionByIdMock.mockResolvedValue(CONN)
  getPbsConnectionByIdUnscopedMock.mockResolvedValue(CONN)
  vdcPbsNamespaceFindManyMock.mockResolvedValue([])
  cookiesMock.mockResolvedValue({ get: () => undefined })
  getVdcScopeMock.mockResolvedValue(null)
  // Base fixtures carry snapshot names; the cases below also cover unknown
  // names, which must remain empty even when a live guest shares the VMID.
  getAllBackupsMock.mockResolvedValue({
    data: [backup(), backup({ id: 'b2', backupId: '101', vmName: 'db-01', datastore: 'store1' })],
    warnings: [],
    fromCache: true,
  })
})

describe('GET /api/v1/pbs/[id]/backups under a token principal', () => {
  it('returns REAL, non-empty backup data unchanged by the guard wrap', async () => {
    currentPrincipal.value = TOKEN_PRINCIPAL
    const { GET } = await import('./route')
    const res = await callRoute(GET, { params: { id: 'pbs-1' } })
    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body.data.backups).toHaveLength(2)
    expect(body.data.backups.map((b: any) => b.vmName).sort()).toEqual(['db-01', 'web-01'])
    expect(body.data.stats.total).toBe(2)
    // Layer 2 defense in depth (already principal-aware since Task 9):
    // checkPermission is called with the RAW pbs connection id, unchanged.
    expect(checkPermissionMock).toHaveBeenCalledWith('backup.view', 'pbs', 'pbs-1')
  })
})

describe('GET /api/v1/pbs/[id]/backups session invariance', () => {
  it('a session caller gets the exact same response shape as before the guard existed', async () => {
    const { GET } = await import('./route')
    const res = await callRoute(GET, { params: { id: 'pbs-1' } })
    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body.data.backups).toHaveLength(2)
    expect(body.data.pagination).toEqual({
      page: 1, pageSize: 50, totalPages: 1, totalItems: 2, hasNext: false, hasPrev: false,
    })
    expect(checkPermissionMock).toHaveBeenCalledWith('backup.view', 'pbs', 'pbs-1')
  })

  it('propagates a permission denial without ever calling assertVdcPbsAccess', async () => {
    const denied = new Response(JSON.stringify({ error: 'Permission denied: backup.view' }), { status: 403 })
    checkPermissionMock.mockResolvedValue(denied)
    const { GET } = await import('./route')
    const res = await callRoute(GET, { params: { id: 'pbs-1' } })
    expect(res.status).toBe(403)
    expect(assertVdcPbsAccessMock).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// P1<->P1.5 seam: the union access verdict must stay untouched, but the
// DISPLAYED namespaces follow the active vDC view context.
// ---------------------------------------------------------------------------
describe('GET /api/v1/pbs/[id]/backups — context-narrowed display', () => {
  const UNION_ALLOWED = [
    { datastore: 'store1', namespace: '' },
    { datastore: 'store1', namespace: 'ns-b' },
  ]

  beforeEach(() => {
    assertVdcPbsAccessMock.mockResolvedValue({ kind: 'tenant', allowed: UNION_ALLOWED })
    getAllBackupsMock.mockResolvedValue({
      data: [
        backup({ id: 'root-1', namespace: '', vmName: 'web-01' }),
        backup({ id: 'nsb-1', namespace: 'ns-b', backupId: '101', vmName: 'db-01' }),
      ],
      warnings: [],
      fromCache: true,
    })
  })

  it('a context-narrowed scope only returns the narrowed namespaces, not the full union', async () => {
    getVdcScopeMock.mockResolvedValue({
      pbsNamespacesByConnection: new Map([['pbs-1', [{ datastore: 'store1', namespace: '' }]]]),
      connectionIds: new Set(),
    })
    const { GET } = await import('./route')
    const res = await callRoute(GET, { params: { id: 'pbs-1' } })
    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body.data.backups).toHaveLength(1)
    expect(body.data.backups[0].namespace).toBe('')
  })

  it('a token caller resolves the scope with { ignoreVdcContext: true } (never depends on the cookie)', async () => {
    currentPrincipal.value = TOKEN_PRINCIPAL
    getVdcScopeMock.mockResolvedValue({
      pbsNamespacesByConnection: new Map([['pbs-1', UNION_ALLOWED]]),
      connectionIds: new Set(),
    })
    const { GET } = await import('./route')
    const res = await callRoute(GET, { params: { id: 'pbs-1' } })
    expect(res.status).toBe(200)
    expect(getVdcScopeMock).toHaveBeenCalledWith('default', { ignoreVdcContext: true })
    const body = await readJson<any>(res)
    // token = union: no entries removed by the (no-op) intersection
    expect(body.data.backups).toHaveLength(2)
  })
})

// Live VMIDs cannot identify the source of a PBS snapshot: even one matching
// live guest can belong to a different cluster or a reused VMID.
describe('PBS backup names belong to the snapshot', () => {
  beforeEach(() => {
    getConnectionByIdMock.mockImplementation(async (id: string) => ({ id }))
    getSessionPrismaMock.mockResolvedValue({
      connection: { findMany: async () => [{ id: 'prod' }, { id: 'dr' }] },
    })
    pveFetchMock.mockImplementation(async (conn: { id: string }) => [
      { vmid: 101, type: 'qemu', name: conn.id === 'prod' ? 'moveme' : 'okcvi' },
    ])
    getAllBackupsMock.mockResolvedValue({
      data: [
        backup({ id: 'prod-snapshot', namespace: 'prod', backupId: '101', vmName: '' }),
        backup({ id: 'dr-snapshot', namespace: 'dr', backupId: '101', vmName: '' }),
        backup({ id: 'named-snapshot', namespace: 'archive', backupId: '101', vmName: 'saved-name', comment: 'saved-name' }),
      ],
      warnings: [],
      fromCache: true,
    })
  })

  it.each([
    ['prod', 'dr'],
    ['dr', 'prod'],
    ['prod'],
  ])('does not borrow a live name when responding clusters are %j', async (...ids) => {
    // The single-cluster case also covers an unregistered/deleted source:
    // a globally unique match is not evidence that it owns the snapshot.
    getSessionPrismaMock.mockResolvedValue({
      connection: { findMany: async () => ids.map(id => ({ id })) },
    })
    const { GET } = await import('./route')
    const res = await callRoute(GET, { params: { id: 'pbs-1' } })
    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body.data.backups.map((b: any) => [b.id, b.namespace, b.vmName])).toEqual([
      ['prod-snapshot', 'prod', ''],
      ['dr-snapshot', 'dr', ''],
      ['named-snapshot', 'archive', 'saved-name'],
    ])
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('keeps the name unknown when the source cluster is unavailable', async () => {
    pveFetchMock.mockImplementation(async (conn: { id: string }) => {
      if (conn.id === 'dr') throw new Error('source unavailable')
      return [{ vmid: 101, type: 'qemu', name: 'moveme' }]
    })
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const { GET } = await import('./route')
      const res = await callRoute(GET, { params: { id: 'pbs-1' }, searchParams: { namespace: 'dr' } })
      const body = await readJson<any>(res)
      expect(res.status).toBe(200)
      expect(body.data.backups).toHaveLength(1)
      expect(body.data.backups[0].vmName).toBe('')
    } finally {
      warn.mockRestore()
    }
  })

  it.each([
    ['moveme', []],
    ['saved-name', ['named-snapshot']],
    ['101', ['prod-snapshot', 'dr-snapshot', 'named-snapshot']],
  ])('searching for %s only matches snapshot metadata', async (search, expectedIds) => {
    const { GET } = await import('./route')
    const res = await callRoute(GET, { params: { id: 'pbs-1' }, searchParams: { search } })
    const body = await readJson<any>(res)
    expect(res.status).toBe(200)
    expect(body.data.backups.map((b: any) => b.id)).toEqual(expectedIds)
  })

  it('keeps separate restore sources and never renames an unknown guest from a live VM', async () => {
    const { GET } = await import('./route')
    const res = await callRoute(GET, { params: { id: 'pbs-1' }, searchParams: { slim: '1' } })
    const body = await readJson<any>(res)
    const guests = groupBackupsByGuest(body.data.backups).filter(g => g.namespace !== 'archive')
    const plan = planTargets({ guests, mode: 'range', rangeStart: 9000, rangeEnd: 9100, usedVmIds: new Set() })
    const requests = plan.entries.map(e => buildRestoreRequest(e, 'pbs-1', { nameSuffix: '-restored' }))
    expect(requests).toHaveLength(2)
    expect(requests.map(r => r?.pbsBackup.namespace).sort()).toEqual(['dr', 'prod'])
    for (const request of requests) {
      expect(request?.pbsBackup).toMatchObject({ pbsId: 'pbs-1', datastore: 'store1', backupPath: 'backup/vm/101/2023-11-14T22:13:20.000Z' })
      expect(request).not.toHaveProperty('name')
    }
  })
})
