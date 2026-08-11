/**
 * Task 22: GET /api/v1/pbs/{id}/datastores builds `allowedDatastores` from
 * the union access verdict (`assertVdcPbsAccess`) without intersecting it
 * with the context-narrowed vDC scope. Fixed here to mirror the pattern
 * already applied to backups/route.ts: the union stays the authorization
 * bound, but the displayed list follows the active vDC view context.
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
      return [{ store: 'ds1', total: 100, used: 10 }, { store: 'ds2', total: 200, used: 20 }]
    }
    if (path.endsWith('/status')) return null
    return []
  })
})

describe('GET /api/v1/pbs/[id]/datastores — tenant, context-narrowed display', () => {
  beforeEach(() => {
    assertVdcPbsAccessMock.mockResolvedValue({ kind: 'tenant', allowed: UNION_ALLOWED })
  })

  it('a context-narrowed scope returns only the narrowed datastore, not the full union', async () => {
    getVdcScopeMock.mockResolvedValue({
      pbsNamespacesByConnection: new Map([['pbs-1', [{ datastore: 'ds1', namespace: '' }]]]),
      connectionIds: new Set(),
    })
    const { GET } = await import('./route')
    const res = await callRoute(GET as Parameters<typeof callRoute>[0], { params: { id: 'pbs-1' } })
    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body.data.map((d: any) => d.name)).toEqual(['ds1'])
  })

  it('deny-by-default: an empty narrowed scope returns an empty list, never falling back to the union', async () => {
    getVdcScopeMock.mockResolvedValue({
      pbsNamespacesByConnection: new Map(),
      connectionIds: new Set(),
    })
    const { GET } = await import('./route')
    const res = await callRoute(GET as Parameters<typeof callRoute>[0], { params: { id: 'pbs-1' } })
    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body.data).toEqual([])
  })
})

describe('GET /api/v1/pbs/[id]/datastores — admin', () => {
  it('sees every datastore and never resolves the vDC scope', async () => {
    assertVdcPbsAccessMock.mockResolvedValue({ kind: 'admin' })
    const { GET } = await import('./route')
    const res = await callRoute(GET as Parameters<typeof callRoute>[0], { params: { id: 'pbs-1' } })
    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body.data.map((d: any) => d.name).sort()).toEqual(['ds1', 'ds2'])
    expect(getVdcScopeMock).not.toHaveBeenCalled()
  })
})
