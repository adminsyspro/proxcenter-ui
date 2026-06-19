import { describe, it, expect, vi, beforeEach } from 'vitest'

import { callRoute, readJson } from '@/__tests__/setup/route-test'

vi.mock('@/lib/rbac', () => ({
  checkPermission: vi.fn<(...args: any[]) => Promise<Response | null>>(),
  PERMISSIONS: {
    BACKUP_VIEW: 'backup.view',
  },
}))

vi.mock('@/lib/vdc/scope', () => ({
  assertVdcPbsAccess: vi.fn<(connId: string) => Promise<any>>(),
}))

vi.mock('@/lib/connections/getConnection', () => ({
  getPbsConnectionById: vi.fn<(id: string) => Promise<any>>(),
  getPbsConnectionByIdUnscoped: vi.fn<(id: string) => Promise<any>>(),
}))

vi.mock('@/lib/proxmox/pbs-client', () => ({
  pbsFetch: vi.fn<(...args: any[]) => Promise<any>>(),
}))

vi.mock('@/lib/cache/pbsBackupCache', () => ({
  invalidatePbsBackupCache: vi.fn<(id?: string) => void>(),
}))

import { DELETE } from './route'
import { checkPermission } from '@/lib/rbac'
import { assertVdcPbsAccess } from '@/lib/vdc/scope'
import { getPbsConnectionById, getPbsConnectionByIdUnscoped } from '@/lib/connections/getConnection'
import { pbsFetch } from '@/lib/proxmox/pbs-client'
import { invalidatePbsBackupCache } from '@/lib/cache/pbsBackupCache'

const checkPermissionMock = checkPermission as any
const assertVdcPbsAccessMock = assertVdcPbsAccess as any
const getPbsConnectionByIdMock = getPbsConnectionById as any
const getPbsConnectionByIdUnscopedMock = getPbsConnectionByIdUnscoped as any
const pbsFetchMock = pbsFetch as any
const invalidatePbsBackupCacheMock = invalidatePbsBackupCache as any

const CONN = { id: 'pbs-1', baseUrl: 'https://pbs.local:8007', apiToken: 'PBS!tok=secret' }

// backupId encodes: datastore/backupType/vmid/timestamp
// e.g. "mystore/vm/100/1700000000"
const BACKUP_ID = encodeURIComponent('mystore/vm/100/1700000000')

beforeEach(() => {
  vi.clearAllMocks()
  checkPermissionMock.mockResolvedValue(null)
  assertVdcPbsAccessMock.mockResolvedValue({ kind: 'admin' })
  getPbsConnectionByIdMock.mockResolvedValue(CONN)
  getPbsConnectionByIdUnscopedMock.mockResolvedValue(CONN)
  pbsFetchMock.mockResolvedValue(null)
  invalidatePbsBackupCacheMock.mockReturnValue(undefined)
})

describe('DELETE /api/v1/pbs/[id]/backups/[backupId]', () => {
  it('returns 200 and calls pbsFetch with correct snapshot path', async () => {
    const res = await callRoute(DELETE as any, {
      method: 'DELETE',
      params: { id: 'pbs-1', backupId: BACKUP_ID },
    })

    expect(res.status).toBe(200)
    const body = await readJson<any>(res)
    expect(body.success).toBe(true)

    expect(pbsFetchMock).toHaveBeenCalledWith(
      CONN,
      expect.stringMatching(/\/admin\/datastore\/mystore\/snapshots/),
      { method: 'DELETE' },
    )
    // query string must include the parsed fields
    const url: string = pbsFetchMock.mock.calls[0][1]
    expect(url).toContain('backup-type=vm')
    expect(url).toContain('backup-id=100')
    expect(url).toContain('backup-time=1700000000')
  })

  it('uses getPbsConnectionById (scoped) when access.kind === admin', async () => {
    assertVdcPbsAccessMock.mockResolvedValue({ kind: 'admin' })

    await callRoute(DELETE as any, {
      method: 'DELETE',
      params: { id: 'pbs-1', backupId: BACKUP_ID },
    })

    expect(getPbsConnectionByIdMock).toHaveBeenCalledWith('pbs-1')
    expect(getPbsConnectionByIdUnscopedMock).not.toHaveBeenCalled()
  })

  it('uses getPbsConnectionByIdUnscoped when access.kind === tenant', async () => {
    assertVdcPbsAccessMock.mockResolvedValue({
      kind: 'tenant',
      allowed: [{ datastore: 'mystore', namespace: '' }],
    })

    await callRoute(DELETE as any, {
      method: 'DELETE',
      params: { id: 'pbs-1', backupId: BACKUP_ID },
    })

    expect(getPbsConnectionByIdUnscopedMock).toHaveBeenCalledWith('pbs-1')
    expect(getPbsConnectionByIdMock).not.toHaveBeenCalled()
  })

  it('invalidates the PBS backup cache on success', async () => {
    await callRoute(DELETE as any, {
      method: 'DELETE',
      params: { id: 'pbs-1', backupId: BACKUP_ID },
    })

    expect(invalidatePbsBackupCacheMock).toHaveBeenCalledWith('pbs-1')
  })

  it('400 when id param is missing', async () => {
    const res = await callRoute(DELETE as any, {
      method: 'DELETE',
      params: { backupId: BACKUP_ID },
    })

    expect(res.status).toBe(400)
    const body = await readJson<any>(res)
    expect(body.error).toContain('Missing params')
    expect(pbsFetchMock).not.toHaveBeenCalled()
  })

  it('400 when backupId param is missing', async () => {
    const res = await callRoute(DELETE as any, {
      method: 'DELETE',
      params: { id: 'pbs-1' },
    })

    expect(res.status).toBe(400)
    expect(pbsFetchMock).not.toHaveBeenCalled()
  })

  it('400 when backupId has fewer than 4 path segments', async () => {
    const res = await callRoute(DELETE as any, {
      method: 'DELETE',
      params: { id: 'pbs-1', backupId: encodeURIComponent('mystore/vm/100') },
    })

    expect(res.status).toBe(400)
    const body = await readJson<any>(res)
    expect(body.error).toContain('Invalid backupId format')
    expect(pbsFetchMock).not.toHaveBeenCalled()
  })

  it('returns the RBAC denial when checkPermission denies', async () => {
    const denied = new Response(JSON.stringify({ error: 'forbidden' }), { status: 403 })
    checkPermissionMock.mockResolvedValue(denied)

    const res = await callRoute(DELETE as any, {
      method: 'DELETE',
      params: { id: 'pbs-1', backupId: BACKUP_ID },
    })

    expect(res.status).toBe(403)
    expect(pbsFetchMock).not.toHaveBeenCalled()
  })

  it('returns the assertVdcPbsAccess denial when tenant has no access', async () => {
    const blocked = new Response(JSON.stringify({ error: 'PBS not accessible' }), { status: 403 })
    assertVdcPbsAccessMock.mockResolvedValue(blocked)

    const res = await callRoute(DELETE as any, {
      method: 'DELETE',
      params: { id: 'pbs-1', backupId: BACKUP_ID },
    })

    expect(res.status).toBe(403)
    expect(pbsFetchMock).not.toHaveBeenCalled()
  })

  it('403 when tenant access allowed list does not include the datastore/namespace', async () => {
    assertVdcPbsAccessMock.mockResolvedValue({
      kind: 'tenant',
      // allowed only for 'otherstore', not 'mystore'
      allowed: [{ datastore: 'otherstore', namespace: '' }],
    })

    const res = await callRoute(DELETE as any, {
      method: 'DELETE',
      params: { id: 'pbs-1', backupId: BACKUP_ID },
    })

    expect(res.status).toBe(403)
    const body = await readJson<any>(res)
    expect(body.error).toContain('not accessible for this tenant')
    expect(pbsFetchMock).not.toHaveBeenCalled()
  })

  it('200 when tenant access allowed list includes the datastore/namespace', async () => {
    assertVdcPbsAccessMock.mockResolvedValue({
      kind: 'tenant',
      allowed: [{ datastore: 'mystore', namespace: '' }],
    })

    // backupId with namespace in path: mystore/ns1/vm/100/1700000000
    // ns = '' from query string would override, so test pure path-derived ns match
    const res = await callRoute(DELETE as any, {
      method: 'DELETE',
      params: { id: 'pbs-1', backupId: BACKUP_ID },
    })

    expect(res.status).toBe(200)
  })

  it('uses ns from query string over namespace derived from backupId path', async () => {
    assertVdcPbsAccessMock.mockResolvedValue({
      kind: 'tenant',
      allowed: [{ datastore: 'mystore', namespace: 'custom-ns' }],
    })

    // backupId has no namespace segments; ns comes from query string
    const res = await callRoute(DELETE as any, {
      method: 'DELETE',
      params: { id: 'pbs-1', backupId: BACKUP_ID },
      searchParams: { ns: 'custom-ns' },
    })

    expect(res.status).toBe(200)
    const url: string = pbsFetchMock.mock.calls[0][1]
    expect(url).toContain('ns=custom-ns')
  })

  it('500 on pbsFetch throw', async () => {
    pbsFetchMock.mockRejectedValue(new Error('PBS connection refused'))

    const res = await callRoute(DELETE as any, {
      method: 'DELETE',
      params: { id: 'pbs-1', backupId: BACKUP_ID },
    })

    expect(res.status).toBe(500)
    const body = await readJson<any>(res)
    expect(body.error).toContain('PBS connection refused')
    // Cache must NOT be invalidated on error
    expect(invalidatePbsBackupCacheMock).not.toHaveBeenCalled()
  })
})
