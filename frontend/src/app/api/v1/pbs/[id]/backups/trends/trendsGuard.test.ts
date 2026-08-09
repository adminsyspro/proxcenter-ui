/**
 * Task 22: GET /api/v1/pbs/{id}/backups/trends builds `allowedNsByStore` from
 * the union access verdict (`assertVdcPbsAccess`) without intersecting it
 * with the context-narrowed vDC scope. Fixed here to mirror the pattern
 * already applied to backups/route.ts: the union stays the authorization
 * bound, but the displayed aggregation follows the active vDC view context.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest'

const {
  checkPermissionMock, assertVdcPbsAccessMock, getVdcScopeMock,
  getPbsConnectionByIdMock, getPbsConnectionByIdUnscopedMock, pbsFetchMock,
} = vi.hoisted(() => ({
  checkPermissionMock: vi.fn<(...a: any[]) => Promise<Response | null>>(),
  assertVdcPbsAccessMock: vi.fn<(id: string) => Promise<any>>(),
  getVdcScopeMock: vi.fn<(...a: any[]) => Promise<any>>(),
  getPbsConnectionByIdMock: vi.fn<(id: string) => Promise<any>>(),
  getPbsConnectionByIdUnscopedMock: vi.fn<(id: string) => Promise<any>>(),
  pbsFetchMock: vi.fn<(...a: any[]) => Promise<any>>(),
}))

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
}))

vi.mock('@/lib/proxmox/pbs-client', () => ({ pbsFetch: pbsFetchMock }))

vi.mock('@/lib/tenant', () => ({
  getCurrentTenantId: vi.fn().mockResolvedValue('default'),
}))

import { callRoute, readJson } from '@/__tests__/setup/route-test'

const CONN = { id: 'pbs-1', baseUrl: 'https://pbs.local:8007', apiToken: 'x' }

function snapshot(overrides: Record<string, any> = {}) {
  const nowSec = Math.floor(Date.now() / 1000)
  return {
    'backup-time': nowSec,
    'backup-type': 'vm',
    size: 1_073_741_824,
    verification: { state: 'ok' },
    ...overrides,
  }
}

const UNION_ALLOWED = [
  { datastore: 'ds1', namespace: '' },
  { datastore: 'ds2', namespace: 'nsB' },
]

beforeEach(() => {
  vi.clearAllMocks()
  checkPermissionMock.mockResolvedValue(null)
  getPbsConnectionByIdMock.mockResolvedValue(CONN)
  getPbsConnectionByIdUnscopedMock.mockResolvedValue(CONN)
  getVdcScopeMock.mockResolvedValue(null)

  pbsFetchMock.mockImplementation(async (_conn: any, path: string) => {
    if (path === '/admin/datastore') {
      return [{ store: 'ds1' }, { store: 'ds2' }]
    }
    if (path === '/admin/datastore/ds1/namespace') return []
    if (path === '/admin/datastore/ds2/namespace') return [{ ns: 'nsB' }]
    if (path.startsWith('/admin/datastore/ds1/snapshots')) return [snapshot()]
    if (path.startsWith('/admin/datastore/ds2/snapshots')) return [snapshot()]
    return []
  })
})

describe('GET /api/v1/pbs/[id]/backups/trends — tenant, context-narrowed display', () => {
  beforeEach(() => {
    assertVdcPbsAccessMock.mockResolvedValue({ kind: 'tenant', allowed: UNION_ALLOWED })
  })

  it('a context-narrowed scope only counts the narrowed datastore, never fetching snapshots on the other one', async () => {
    getVdcScopeMock.mockResolvedValue({
      pbsNamespacesByConnection: new Map([['pbs-1', [{ datastore: 'ds1', namespace: '' }]]]),
      connectionIds: new Set(),
    })
    const { GET } = await import('./route')
    const res = await callRoute(GET as Parameters<typeof callRoute>[0], { params: { id: 'pbs-1' } })
    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body.data.totalBackups).toBe(1)
    expect(body.data.daily.reduce((sum: number, d: any) => sum + d.total, 0)).toBe(1)
    const fetchedPaths = pbsFetchMock.mock.calls.map((c: any[]) => c[1] as string)
    expect(fetchedPaths.some(p => p.startsWith('/admin/datastore/ds2/snapshots'))).toBe(false)
  })

  it('narrowed == union (no view context) counts everything — non-regression on the aggregated view', async () => {
    getVdcScopeMock.mockResolvedValue({
      pbsNamespacesByConnection: new Map([['pbs-1', UNION_ALLOWED]]),
      connectionIds: new Set(),
    })
    const { GET } = await import('./route')
    const res = await callRoute(GET as Parameters<typeof callRoute>[0], { params: { id: 'pbs-1' } })
    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body.data.totalBackups).toBe(2)
  })

  it('deny-by-default: pbsNamespacesByConnection.get(id) undefined → zero backups, no snapshot fetch at all', async () => {
    getVdcScopeMock.mockResolvedValue({
      pbsNamespacesByConnection: new Map(),
      connectionIds: new Set(),
    })
    const { GET } = await import('./route')
    const res = await callRoute(GET as Parameters<typeof callRoute>[0], { params: { id: 'pbs-1' } })
    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body.data.totalBackups).toBe(0)
    const fetchedPaths = pbsFetchMock.mock.calls.map((c: any[]) => c[1] as string)
    expect(fetchedPaths.some(p => p.includes('/snapshots'))).toBe(false)
  })
})

describe('GET /api/v1/pbs/[id]/backups/trends — admin', () => {
  it('sees every datastore/namespace unfiltered and never resolves the vDC scope', async () => {
    assertVdcPbsAccessMock.mockResolvedValue({ kind: 'admin' })
    const { GET } = await import('./route')
    const res = await callRoute(GET as Parameters<typeof callRoute>[0], { params: { id: 'pbs-1' } })
    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    // ds1 root namespace (1) + ds2 root and 'nsB' namespaces (2), unfiltered.
    expect(body.data.totalBackups).toBe(3)
    expect(getVdcScopeMock).not.toHaveBeenCalled()
  })
})
