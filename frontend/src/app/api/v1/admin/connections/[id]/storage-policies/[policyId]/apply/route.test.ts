/**
 * POST /api/v1/admin/connections/{id}/storage-policies/{policyId}/apply:
 * provider-only bulk re-stamp of a storage policy onto every existing disk
 * across every VM in every assigned vDC pool. Streams NDJSON progress
 * (start/vm-line/done) so the edit dialog can drive a live progress bar.
 *
 * restampGuestDrives itself never throws (pinned by driveGuard.test.ts): a
 * real PVE GET/PUT failure surfaces there as an empty stamped array, i.e.
 * the SAME "unchanged" status as a genuine no-op. The per-VM try/catch this
 * route wraps around the call is defensive (guards a future regression in
 * that contract, or any other unexpected exception mid-loop); exercised
 * below by mocking restampGuestDrives itself to reject for one VM.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextResponse } from 'next/server'
import { callRoute } from '@/__tests__/setup/route-test'

const {
  requireProviderTenantMock,
  checkPermissionMock,
  getServerSessionMock,
  storagePolicyFindUniqueMock,
  vdcStoragePolicyFindManyMock,
  connectionFindUniqueMock,
  getConnectionByIdMock,
  pveFetchMock,
  restampGuestDrivesMock,
  auditMock,
} = vi.hoisted(() => ({
  requireProviderTenantMock: vi.fn(),
  checkPermissionMock: vi.fn(),
  getServerSessionMock: vi.fn(),
  storagePolicyFindUniqueMock: vi.fn(),
  vdcStoragePolicyFindManyMock: vi.fn(),
  connectionFindUniqueMock: vi.fn(),
  getConnectionByIdMock: vi.fn(),
  pveFetchMock: vi.fn(),
  restampGuestDrivesMock: vi.fn(),
  auditMock: vi.fn(),
}))

vi.mock('@/lib/tenant', () => ({
  requireProviderTenant: (...a: unknown[]) => requireProviderTenantMock(...a),
  DEFAULT_TENANT_ID: 'default',
}))

vi.mock('@/lib/rbac', () => ({
  checkPermission: (...a: unknown[]) => checkPermissionMock(...a),
  PERMISSIONS: { ADMIN_SETTINGS: 'admin.settings' },
}))

vi.mock('next-auth', () => ({
  getServerSession: (...a: unknown[]) => getServerSessionMock(...a),
}))

vi.mock('@/lib/auth/config', () => ({ authOptions: {} }))

vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    storagePolicy: { findUnique: (...a: unknown[]) => storagePolicyFindUniqueMock(...a) },
    vdcStoragePolicy: { findMany: (...a: unknown[]) => vdcStoragePolicyFindManyMock(...a) },
    connection: { findUnique: (...a: unknown[]) => connectionFindUniqueMock(...a) },
  },
}))

vi.mock('@/lib/connections/getConnection', () => ({
  getConnectionById: (...a: unknown[]) => getConnectionByIdMock(...a),
}))

vi.mock('@/lib/proxmox/client', () => ({
  pveFetch: (...a: unknown[]) => pveFetchMock(...a),
}))

vi.mock('@/lib/vdc/driveGuard', () => ({
  restampGuestDrives: (...a: unknown[]) => restampGuestDrivesMock(...a),
}))

vi.mock('@/lib/audit', () => ({ audit: (...a: unknown[]) => auditMock(...a) }))

import { POST } from './route'

const CONN_ID = 'conn-1'
const POLICY_ID = 'policy-1'

const POLICY_ROW = {
  id: POLICY_ID,
  name: 'Gold NVMe',
  connectionId: CONN_ID,
  storageId: 'nvme-pool',
  iopsRd: 5000,
  iopsWr: 5000,
  mbpsRd: null,
  mbpsWr: null,
}

async function readLines(res: Response): Promise<any[]> {
  const text = await res.text()
  return text.split('\n').filter((l) => l.trim().length > 0).map((l) => JSON.parse(l))
}

beforeEach(() => {
  vi.clearAllMocks()
  requireProviderTenantMock.mockResolvedValue(null)
  checkPermissionMock.mockResolvedValue(null)
  getServerSessionMock.mockResolvedValue({ user: { id: 'admin-1', tenantId: 'default' } })
  storagePolicyFindUniqueMock.mockResolvedValue(POLICY_ROW)
  vdcStoragePolicyFindManyMock.mockResolvedValue([{ vdc: { pvePoolName: 'vdc-acme-prod' } }])
  connectionFindUniqueMock.mockResolvedValue({ tenantId: 'tenant-acme' })
  getConnectionByIdMock.mockResolvedValue({ id: CONN_ID })
  pveFetchMock.mockResolvedValue({
    members: [
      { type: 'qemu', vmid: 101, node: 'pve1', name: 'web-01' },
      { type: 'qemu', vmid: 102, node: 'pve1', name: 'web-02' },
      { type: 'lxc', vmid: 103, node: 'pve1', name: 'ct-01' },
    ],
  })
  restampGuestDrivesMock.mockImplementation(async ({ configPath }: any) => (
    configPath.includes('/101/') ? { stamped: ['scsi0'] } : { stamped: [] }
  ))
  auditMock.mockResolvedValue('audit-1')
})

describe('POST .../storage-policies/{policyId}/apply', () => {
  it('returns the guard deny response as-is', async () => {
    checkPermissionMock.mockResolvedValue(NextResponse.json({ error: 'nope' }, { status: 403 }))

    const res = await callRoute(POST as Parameters<typeof callRoute>[0], {
      method: 'POST', params: { id: CONN_ID, policyId: POLICY_ID },
    })

    expect(res.status).toBe(403)
    expect(storagePolicyFindUniqueMock).not.toHaveBeenCalled()
  })

  it('404s an unknown or foreign policyId', async () => {
    storagePolicyFindUniqueMock.mockResolvedValue({ ...POLICY_ROW, connectionId: 'other-conn' })

    const res = await callRoute(POST as Parameters<typeof callRoute>[0], {
      method: 'POST', params: { id: CONN_ID, policyId: POLICY_ID },
    })

    expect(res.status).toBe(404)
    expect(await res.json()).toEqual({ error: 'Storage policy not found' })
  })

  it('immediately emits done with total 0 when the policy has no vDC assignments', async () => {
    vdcStoragePolicyFindManyMock.mockResolvedValue([])

    const res = await callRoute(POST as Parameters<typeof callRoute>[0], {
      method: 'POST', params: { id: CONN_ID, policyId: POLICY_ID },
    })

    expect(res.status).toBe(200)
    const lines = await readLines(res)
    expect(lines).toEqual([
      { type: 'start', total: 0 },
      { type: 'done', updated: 0, unchanged: 0, errors: 0 },
    ])
    expect(getConnectionByIdMock).not.toHaveBeenCalled()
    expect(auditMock).not.toHaveBeenCalled()
  })

  it('streams start/vm/done for a 2-VM qemu pool (lxc excluded), 1 updated + 1 unchanged', async () => {
    const res = await callRoute(POST as Parameters<typeof callRoute>[0], {
      method: 'POST', params: { id: CONN_ID, policyId: POLICY_ID },
    })

    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('application/x-ndjson')
    const lines = await readLines(res)

    expect(lines[0]).toEqual({ type: 'start', total: 2 })
    expect(lines[1]).toMatchObject({
      type: 'vm', index: 0, total: 2, vmid: 101, name: 'web-01', node: 'pve1', disks: ['scsi0'], status: 'updated',
    })
    expect(lines[2]).toMatchObject({
      type: 'vm', index: 1, total: 2, vmid: 102, name: 'web-02', node: 'pve1', disks: [], status: 'unchanged',
    })
    expect(lines[3]).toEqual({ type: 'done', updated: 1, unchanged: 1, errors: 0 })

    expect(restampGuestDrivesMock).toHaveBeenCalledTimes(2)
    expect(getConnectionByIdMock).toHaveBeenCalledWith(CONN_ID, 'tenant-acme')
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({
      action: 'update',
      resourceType: 'storage-policy',
      details: expect.objectContaining({ applied: true, updated: 1, errors: 0 }),
    }))
  })

  it('a VM whose restamp throws yields a vm line with status error, and the stream still completes', async () => {
    restampGuestDrivesMock.mockImplementation(async ({ configPath }: any) => {
      if (configPath.includes('/101/')) throw new Error('PVE unreachable')
      return { stamped: [] }
    })

    const res = await callRoute(POST as Parameters<typeof callRoute>[0], {
      method: 'POST', params: { id: CONN_ID, policyId: POLICY_ID },
    })

    const lines = await readLines(res)
    expect(lines[1]).toMatchObject({ type: 'vm', vmid: 101, status: 'error', message: 'PVE unreachable' })
    expect(lines[2]).toMatchObject({ type: 'vm', vmid: 102, status: 'unchanged' })
    expect(lines[3]).toEqual({ type: 'done', updated: 0, unchanged: 1, errors: 1 })
  })
})
