import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { callRoute, deniedPermissionResponse, readJson } from '@/__tests__/setup/route-test'

vi.mock('@/lib/rbac', () => ({
  checkPermission: vi.fn(),
  PERMISSIONS: { CONNECTION_MANAGE: 'connection.manage' },
}))
vi.mock('@/lib/connections/getConnection', () => ({ getConnectionById: vi.fn() }))
vi.mock('@/lib/tenant', () => ({ getCurrentTenantId: vi.fn(), getSessionPrisma: vi.fn() }))
vi.mock('@/lib/tenant/infraScope', () => ({ getTenantInfrastructureScope: vi.fn(), maskingScope: vi.fn() }))
vi.mock('@/lib/audit', () => ({ audit: vi.fn() }))
vi.mock('@/lib/storage/attachPbsStorage', () => ({
  detachPbsStorage: vi.fn(),
  PbsAttachError: class PbsAttachError extends Error {
    constructor(message: string, readonly status = 400, readonly code = 'invalid_request') {
      super(message)
      this.name = 'PbsAttachError'
    }
  },
}))

import { audit } from '@/lib/audit'
import { getConnectionById } from '@/lib/connections/getConnection'
import { checkPermission, PERMISSIONS } from '@/lib/rbac'
import { detachPbsStorage, PbsAttachError, type DetachPbsStorageResult } from '@/lib/storage/attachPbsStorage'
import { getCurrentTenantId, getSessionPrisma } from '@/lib/tenant'
import { getTenantInfrastructureScope, maskingScope } from '@/lib/tenant/infraScope'

import { DELETE } from './route'

const conn = {
  id: 'c1', name: 'prod', baseUrl: 'https://pve.lab:8006',
  apiToken: 'root@pam!admin:secret', insecureDev: true, behindProxy: false,
}
const sibling = { ...conn, id: 'c2', name: 'sibling' }
const params = { id: 'c1', storage: 'pbs-main' }
const findMany = vi.fn()
const detachResult: DetachPbsStorageResult = {
  storage: 'pbs-main', token: 'revoked', tokenId: 'root@pam!pxc-x',
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(checkPermission).mockResolvedValue(null)
  vi.mocked(getCurrentTenantId).mockResolvedValue('provider-tenant')
  vi.mocked(getTenantInfrastructureScope).mockResolvedValue({ kind: 'provider' } as any)
  vi.mocked(maskingScope).mockReturnValue(null)
  vi.mocked(getConnectionById).mockImplementation(async id => {
    if (id === conn.id) return conn
    if (id === sibling.id) return sibling
    throw new Error(`Unexpected connection: ${id}`)
  })
  findMany.mockResolvedValue([
    { id: 'c1', name: 'c1', type: 'pve' }, { id: 'c2', name: 'other-cluster', type: 'pve' },
    { id: 'pbs1', name: 'pbs1', type: 'pbs' }, { id: 'pbs2', name: 'pbs2', type: 'pbs' },
  ])
  vi.mocked(getSessionPrisma).mockResolvedValue({ connection: { findMany } } as any)
  vi.mocked(detachPbsStorage).mockResolvedValue(detachResult)
  vi.spyOn(console, 'warn').mockImplementation(() => undefined)
})

afterEach(() => vi.restoreAllMocks())

describe('DELETE /api/v1/connections/[id]/storage/[storage]', () => {
  it.each([{}, { id: 'c1' }, { storage: 'pbs-main' }])('returns 400 for incomplete params %j', async missingParams => {
    const res = await callRoute(DELETE, { method: 'DELETE', params: missingParams })

    expect(res.status).toBe(400)
    expect(await readJson(res)).toEqual({ error: 'Missing params' })
    expect(detachPbsStorage).not.toHaveBeenCalled()
    expect(checkPermission).not.toHaveBeenCalled()
  })

  it('requires CONNECTION_MANAGE on the target cluster', async () => {
    // `as any`: the real checkPermission is typed NextResponse, the shared
    // helper hands back a plain Response, and the route only ever returns it.
    vi.mocked(checkPermission).mockResolvedValue(deniedPermissionResponse() as any)

    const res = await callRoute(DELETE, { method: 'DELETE', params })

    expect(res.status).toBe(403)
    expect(checkPermission).toHaveBeenCalledWith(PERMISSIONS.CONNECTION_MANAGE, 'connection', 'c1')
    expect(detachPbsStorage).not.toHaveBeenCalled()
  })

  it('denies a masked vDC tenant', async () => {
    vi.mocked(getCurrentTenantId).mockResolvedValue('tenant-vdc')
    vi.mocked(getTenantInfrastructureScope).mockResolvedValue({ kind: 'iaas', vdcScope: {} } as any)
    vi.mocked(maskingScope).mockReturnValue({ storagesByConnection: new Map() } as any)

    const res = await callRoute(DELETE, { method: 'DELETE', params })

    expect(res.status).toBe(403)
    expect(getTenantInfrastructureScope).toHaveBeenCalledWith('tenant-vdc')
    expect(detachPbsStorage).not.toHaveBeenCalled()
    expect(getSessionPrisma).not.toHaveBeenCalled()
  })

  it('splits the session tenant listing into PVE siblings and PBS ids', async () => {
    const res = await callRoute(DELETE, { method: 'DELETE', params })

    expect(res.status).toBe(200)
    expect(getSessionPrisma).toHaveBeenCalledTimes(1)
    expect(findMany).toHaveBeenCalledWith({
      where: { type: { in: ['pve', 'pbs'] } }, select: { id: true, name: true, type: true },
    })
    expect(getConnectionById).toHaveBeenCalledTimes(2)
    expect(getConnectionById).toHaveBeenNthCalledWith(1, 'c1')
    expect(getConnectionById).toHaveBeenNthCalledWith(2, 'c2')
    expect(detachPbsStorage).toHaveBeenCalledExactlyOnceWith({
      pveConn: conn, storage: 'pbs-main', siblingConns: [sibling], unverifiableConns: [],
      pbsConnectionIds: ['pbs1', 'pbs2'],
    })
  })

  it('hands an unresolvable sibling over as unverifiable and still detaches', async () => {
    findMany.mockResolvedValue([
      { id: 'c1', name: 'c1', type: 'pve' }, { id: 'unresolvable', name: 'Ghost cluster', type: 'pve' },
      { id: 'c2', name: 'other-cluster', type: 'pve' }, { id: 'pbs1', name: 'pbs1', type: 'pbs' },
    ])

    // The default connection mock throws for the unresolvable row. Its name
    // must reach the lib, which counts it as a token user: a cluster that
    // cannot be cleared must not have its credential revoked under it.
    const res = await callRoute(DELETE, { method: 'DELETE', params })

    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual({ data: detachResult })
    expect(getConnectionById).toHaveBeenCalledWith('unresolvable')
    expect(detachPbsStorage).toHaveBeenCalledExactlyOnceWith({
      pveConn: conn, storage: 'pbs-main', siblingConns: [sibling],
      unverifiableConns: ['Ghost cluster'], pbsConnectionIds: ['pbs1'],
    })
  })

  it('returns the token verdict and audits a successful detach', async () => {
    const result: DetachPbsStorageResult = { ...detachResult, token: 'kept-in-use', usedBy: ['sibling'] }

    vi.mocked(detachPbsStorage).mockResolvedValue(result)

    const res = await callRoute(DELETE, { method: 'DELETE', params })

    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual({ data: result })
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'delete', category: 'storage', resourceId: 'pbs-main', status: 'success',
      details: expect.objectContaining({ token: 'kept-in-use', tokenId: result.tokenId, usedBy: ['sibling'] }),
    }))
  })

  it('audits a token revocation failure as a warning while returning success', async () => {
    const result: DetachPbsStorageResult = { ...detachResult, token: 'revoke-failed' }

    vi.mocked(detachPbsStorage).mockResolvedValue(result)

    const res = await callRoute(DELETE, { method: 'DELETE', params })

    expect(res.status).toBe(200)
    expect(await readJson(res)).toEqual({ data: result })
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      status: 'warning', details: expect.objectContaining({ token: 'revoke-failed' }),
    }))
  })

  it.each([
    [404, 'storage_not_found'],
    [400, 'storage_not_pbs'],
  ])('maps PbsAttachError to status %s and code %s', async (status, code) => {
    vi.mocked(detachPbsStorage).mockRejectedValue(new PbsAttachError('Detach failed', status, code))

    const res = await callRoute(DELETE, { method: 'DELETE', params })

    expect(res.status).toBe(status)
    expect(await readJson(res)).toEqual({ error: 'Detach failed', code })
    expect(audit).toHaveBeenCalledWith(expect.objectContaining({
      status: 'failure', errorMessage: 'Detach failed', resourceId: 'pbs-main',
    }))
  })
})
