import { describe, it, expect, vi, beforeEach } from 'vitest'

// The API token guard is covered by routeGuard.test.ts and writeContract.test.ts:
// pass-through so this file keeps testing the handler, as for a session caller.
vi.mock('@/lib/api-tokens/routeGuard', () => ({
  withPublicApiGuard: (_entryId: string, handler: any) => handler,
}))

import { callRoute, readJson } from '@/__tests__/setup/route-test'

vi.mock('@/lib/rbac', () => ({
  checkPermission: vi.fn<(...args: any[]) => Promise<Response | null>>(),
  PERMISSIONS: {
    BACKUP_VIEW: 'backup.view',
    VM_BACKUP: 'vm.backup',
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

import { POST } from './route'
import { checkPermission } from '@/lib/rbac'
import { assertVdcPbsAccess } from '@/lib/vdc/scope'
import { getPbsConnectionById, getPbsConnectionByIdUnscoped } from '@/lib/connections/getConnection'
import { pbsFetch } from '@/lib/proxmox/pbs-client'

const checkPermissionMock = checkPermission as any
const assertVdcPbsAccessMock = assertVdcPbsAccess as any
const getPbsConnectionByIdMock = getPbsConnectionById as any
const getPbsConnectionByIdUnscopedMock = getPbsConnectionByIdUnscoped as any
const pbsFetchMock = pbsFetch as any

const CONN = { id: 'pbs-1', baseUrl: 'https://pbs.local:8007', apiToken: 'PBS!tok=secret' }
const BACKUP_ID = encodeURIComponent('mystore/vm/100/1700000000')
const UPID = 'UPID:pbs:00000001:00000002:00000003:verify:mystore:root@pam:'

/** Grant exactly the listed permissions, deny everything else. */
function grantOnly(...perms: string[]) {
  checkPermissionMock.mockImplementation(async (perm: string) =>
    perms.includes(perm) ? null : new Response(JSON.stringify({ error: `Permission denied: ${perm}` }), { status: 403 }))
}

beforeEach(() => {
  vi.clearAllMocks()
  checkPermissionMock.mockResolvedValue(null)
  assertVdcPbsAccessMock.mockResolvedValue({ kind: 'admin' })
  getPbsConnectionByIdMock.mockResolvedValue(CONN)
  getPbsConnectionByIdUnscopedMock.mockResolvedValue(CONN)
  pbsFetchMock.mockResolvedValue(UPID)
})

describe('POST /api/v1/pbs/[id]/backups/[backupId]/verify', () => {
  it('posts the snapshot coordinates to PBS and returns the UPID', async () => {
    const res = await callRoute(POST as any, {
      method: 'POST',
      params: { id: 'pbs-1', backupId: BACKUP_ID },
    })

    expect(res.status).toBe(200)
    expect((await readJson<any>(res)).data).toBe(UPID)
    expect(pbsFetchMock).toHaveBeenCalledWith(CONN, '/admin/datastore/mystore/verify', {
      method: 'POST',
      body: JSON.stringify({ 'backup-type': 'vm', 'backup-id': '100', 'backup-time': 1700000000 }),
    })
  })

  // Re-verifying a snapshot needs vm.backup: seeing the backups is not enough.
  it('403 for a caller holding backup.view only', async () => {
    grantOnly('backup.view')

    const res = await callRoute(POST as any, {
      method: 'POST',
      params: { id: 'pbs-1', backupId: BACKUP_ID },
    })

    expect(res.status).toBe(403)
    expect(pbsFetchMock).not.toHaveBeenCalled()
  })

  it('checks vm.backup on the PBS connection and passes when it is held', async () => {
    grantOnly('vm.backup')

    const res = await callRoute(POST as any, {
      method: 'POST',
      params: { id: 'pbs-1', backupId: BACKUP_ID },
    })

    expect(res.status).toBe(200)
    expect(checkPermissionMock).toHaveBeenCalledWith('vm.backup', 'pbs', 'pbs-1')
  })

  it('403 when the tenant has no binding on the datastore/namespace', async () => {
    assertVdcPbsAccessMock.mockResolvedValue({ kind: 'tenant', allowed: [{ datastore: 'otherstore', namespace: '' }] })

    const res = await callRoute(POST as any, {
      method: 'POST',
      params: { id: 'pbs-1', backupId: BACKUP_ID },
    })

    expect(res.status).toBe(403)
    expect(pbsFetchMock).not.toHaveBeenCalled()
  })
})
