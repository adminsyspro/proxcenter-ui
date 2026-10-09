import { beforeEach, describe, expect, it, vi } from 'vitest'

import { NextResponse } from 'next/server'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

const {
  checkPermissionMock, accessMock, pbsMock, pbsUnscopedMock, connMock, findManyMock, tenantMock, infraMock, pveFetchMock,
} = vi.hoisted(() => ({
  checkPermissionMock: vi.fn(),
  accessMock: vi.fn(),
  pbsMock: vi.fn(),
  pbsUnscopedMock: vi.fn(),
  connMock: vi.fn(),
  findManyMock: vi.fn(),
  tenantMock: vi.fn(),
  infraMock: vi.fn(),
  pveFetchMock: vi.fn(),
}))

vi.mock('@/lib/rbac', () => ({
  PERMISSIONS: { BACKUP_VIEW: 'backup.view' },
  checkPermission: (...a: any[]) => checkPermissionMock(...a),
}))
vi.mock('@/lib/vdc/scope', () => ({ assertVdcPbsAccess: (...a: any[]) => accessMock(...a) }))
vi.mock('@/lib/connections/getConnection', () => ({
  getConnectionByIdOrNull: (...a: any[]) => connMock(...a),
  getPbsConnectionById: (...a: any[]) => pbsMock(...a),
  getPbsConnectionByIdUnscoped: (...a: any[]) => pbsUnscopedMock(...a),
}))
vi.mock('@/lib/db/prisma', () => ({ prisma: { connection: { findMany: (...a: any[]) => findManyMock(...a) } } }))
vi.mock('@/lib/tenant', () => ({ getCurrentTenantId: () => tenantMock() }))
vi.mock('@/lib/tenant/infraScope', () => ({ getTenantInfrastructureScope: (...a: any[]) => infraMock(...a) }))
vi.mock('@/lib/proxmox/client', () => ({ pveFetch: (...a: any[]) => pveFetchMock(...a) }))

import { GET } from './route'

const pbsStorage = (storage: string, extra: Record<string, unknown> = {}) => ({
  type: 'pbs', storage, server: 'pbs.lab', datastore: 'ds1', namespace: '', ...extra,
})

function call(search: Record<string, string> = { datastore: 'ds1' }, id = 'pbs1') {
  return callRoute(GET, { params: { id }, searchParams: search })
}

beforeEach(() => {
  checkPermissionMock.mockReset().mockResolvedValue(null)
  accessMock.mockReset().mockResolvedValue({ kind: 'admin' })
  pbsMock.mockReset().mockResolvedValue({ baseUrl: 'https://PBS.lab:8007' })
  pbsUnscopedMock.mockReset().mockResolvedValue({ baseUrl: 'https://pbs.lab:8007' })
  connMock.mockReset().mockImplementation(async (id: string) => ({ id }))
  findManyMock.mockReset().mockResolvedValue([{ id: 'c1', name: 'Alpha' }, { id: 'c2', name: 'Beta' }])
  tenantMock.mockReset().mockResolvedValue('default')
  infraMock.mockReset().mockResolvedValue({ kind: 'provider' })
  pveFetchMock.mockReset().mockImplementation(async (conn: { id: string }) => (conn.id === 'c1'
    ? [pbsStorage('pbs-a', { nodes: 'pve1, pve2' }), pbsStorage('other', { datastore: 'ds2' }), { type: 'dir', storage: 'local' }]
    : [pbsStorage('pbs-b')]))
})

describe('GET /api/v1/pbs/[id]/pve-storages', () => {
  it('lists the matching pbs storages of every readable PVE connection (admin)', async () => {
    const res = await call()
    expect(res.status).toBe(200)
    expect(((await readJson(res)) as any).data).toEqual([
      { connId: 'c1', connName: 'Alpha', storage: 'pbs-a', nodes: ['pve1', 'pve2'] },
      { connId: 'c2', connName: 'Beta', storage: 'pbs-b', nodes: [] },
    ])
    expect(pbsMock).toHaveBeenCalledWith('pbs1')
    expect(pbsUnscopedMock).not.toHaveBeenCalled()
    expect(findManyMock.mock.calls[0][0].where).toEqual({ type: 'pve' })
    expect(pveFetchMock).toHaveBeenCalledWith({ id: 'c1' }, '/storage', {}, { timeoutMs: 10_000 })
  })

  it('returns the PBS RBAC denial', async () => {
    checkPermissionMock.mockResolvedValueOnce(NextResponse.json({ error: 'Forbidden' }, { status: 403 }))
    const res = await call()
    expect(res.status).toBe(403)
    expect(accessMock).not.toHaveBeenCalled()
  })

  it('returns the vDC access denial', async () => {
    accessMock.mockResolvedValue(NextResponse.json({ error: 'PBS not accessible' }, { status: 403 }))
    const res = await call()
    expect(res.status).toBe(403)
  })

  it('requires a datastore', async () => {
    const res = await call({ datastore: '  ' })
    expect(res.status).toBe(400)
    expect(await readJson(res)).toEqual({ error: 'Missing required parameter: datastore' })
  })

  it('rejects a missing id', async () => {
    const res = await call({ datastore: 'ds1' }, '')
    expect(res.status).toBe(400)
  })

  it('refuses a tenant a datastore/namespace it is not bound to', async () => {
    accessMock.mockResolvedValue({ kind: 'tenant', allowed: [{ datastore: 'ds1', namespace: 'tenant-a' }] })
    const res = await call({ datastore: 'ds1', ns: 'tenant-b' })
    expect(res.status).toBe(403)
  })

  it('serves an iaas tenant through the unscoped PBS lookup and its vDC storage filter', async () => {
    accessMock.mockResolvedValue({ kind: 'tenant', allowed: [{ datastore: 'ds1', namespace: 'ns1' }] })
    tenantMock.mockResolvedValue('t1')
    infraMock.mockResolvedValue({
      kind: 'iaas',
      vdcScope: { connectionIds: new Set(['c1', 'c2']), storagesByConnection: new Map([['c1', new Set(['pbs-a'])]]) },
    })
    pveFetchMock.mockImplementation(async (conn: { id: string }) => [
      pbsStorage(conn.id === 'c1' ? 'pbs-a' : 'pbs-b', { namespace: 'ns1' }),
      pbsStorage('hidden', { namespace: 'ns1' }),
    ])
    const res = await call({ datastore: 'ds1', ns: ' ns1 ' })
    expect(res.status).toBe(200)
    expect(((await readJson(res)) as any).data).toEqual([{ connId: 'c1', connName: 'Alpha', storage: 'pbs-a', nodes: [] }])
    expect(pbsUnscopedMock).toHaveBeenCalledWith('pbs1')
    expect(findManyMock.mock.calls[0][0].where).toEqual({ type: 'pve', id: { in: ['c1', 'c2'] } })
  })

  it('limits an msp tenant to its own connections', async () => {
    tenantMock.mockResolvedValue('t2')
    infraMock.mockResolvedValue({ kind: 'msp', connectionIds: new Set(['c2']) })
    findManyMock.mockResolvedValue([{ id: 'c2', name: 'Beta' }])
    const res = await call()
    expect(((await readJson(res)) as any).data).toEqual([{ connId: 'c2', connName: 'Beta', storage: 'pbs-b', nodes: [] }])
    expect(findManyMock.mock.calls[0][0].where).toEqual({ type: 'pve', id: { in: ['c2'] } })
  })

  it('scopes a non-default tenant without a connection filter to its own tenantId', async () => {
    tenantMock.mockResolvedValue('t3')
    await call()
    expect(findManyMock.mock.calls[0][0].where).toEqual({ type: 'pve', tenantId: 't3' })
  })

  it('skips connections the caller cannot read, that vanished, or that are unreachable', async () => {
    findManyMock.mockResolvedValue([{ id: 'c1', name: 'Alpha' }, { id: 'c2', name: 'Beta' }, { id: 'c3', name: 'Gamma' }])
    checkPermissionMock.mockImplementation(async (_p: string, kind: string, id: string) =>
      (kind === 'connection' && id === 'c1' ? NextResponse.json({}, { status: 403 }) : null))
    connMock.mockImplementation(async (id: string) => (id === 'c2' ? null : { id }))
    pveFetchMock.mockRejectedValue(new Error('unreachable'))
    const res = await call()
    expect(res.status).toBe(200)
    expect(((await readJson(res)) as any).data).toEqual([])
  })

  it('maps an unexpected error to 500', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    pbsMock.mockRejectedValue(new Error('PBS connection not found'))
    const res = await call()
    expect(res.status).toBe(500)
    expect(await readJson(res)).toEqual({ error: 'PBS connection not found' })
  })

  it('falls back to a generic 500 message', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    pbsMock.mockRejectedValue({})
    const res = await call()
    expect(await readJson(res)).toEqual({ error: 'Erreur serveur' })
  })
})
