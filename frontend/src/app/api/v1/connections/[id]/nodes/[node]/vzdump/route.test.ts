/**
 * POST /api/v1/connections/[id]/nodes/[node]/vzdump: the backup destination
 * is a WRITE, judged on the tenant's writable storages (#894). A read-only
 * ISO library the tenant can see is never a valid vzdump target.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { callRoute } from '@/__tests__/setup/route-test'

const { checkPermissionMock, getCurrentTenantIdMock, getInfraMock, getConnectionByIdMock, pveFetchMock } = vi.hoisted(() => ({
  checkPermissionMock: vi.fn(),
  getCurrentTenantIdMock: vi.fn(),
  getInfraMock: vi.fn(),
  getConnectionByIdMock: vi.fn(),
  pveFetchMock: vi.fn(),
}))

vi.mock('@/lib/rbac', () => ({
  checkPermission: (...a: unknown[]) => checkPermissionMock(...a),
  buildNodeResourceId: (id: string, node: string) => `${id}:${node}`,
  PERMISSIONS: { VM_BACKUP: 'vm.backup' },
}))
vi.mock('@/lib/tenant', () => ({
  getCurrentTenantId: (...a: unknown[]) => getCurrentTenantIdMock(...a),
  DEFAULT_TENANT_ID: 'default',
}))
vi.mock('@/lib/tenant/infraScope', () => ({
  getTenantInfrastructureScope: (...a: unknown[]) => getInfraMock(...a),
}))
vi.mock('@/lib/connections/getConnection', () => ({
  getConnectionById: (...a: unknown[]) => getConnectionByIdMock(...a),
}))
vi.mock('@/lib/proxmox/client', async (io) => {
  const actual = await io<typeof import('@/lib/proxmox/client')>()
  return { ...actual, pveFetch: (...a: unknown[]) => pveFetchMock(...a) }
})

const params = { id: 'conn-1', node: 'pve1' }

function libraryScope() {
  return {
    kind: 'iaas',
    vdcScope: {
      storagesByConnection: new Map([['conn-1', new Set(['ceph', 'isolib'])]]),
      writableStoragesByConnection: new Map([['conn-1', new Set(['ceph'])]]),
      isoLibrariesByConnection: new Map([['conn-1', new Set(['isolib'])]]),
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  checkPermissionMock.mockResolvedValue(null)
  getCurrentTenantIdMock.mockResolvedValue('tenant-1')
  getInfraMock.mockResolvedValue(libraryScope())
  getConnectionByIdMock.mockResolvedValue({ id: 'conn-1' })
  pveFetchMock.mockResolvedValue('UPID:pve1:vzdump:1')
})

describe('POST vzdump: read-only ISO library destination (#894)', () => {
  it('403: a library storage is refused as backup destination and PVE is never called', async () => {
    const { POST } = await import('./route')
    const res = await callRoute(POST as Parameters<typeof callRoute>[0], {
      method: 'POST', params, body: { vmid: 100, storage: 'isolib' },
    })
    expect(res.status).toBe(403)
    expect(((await res.json()) as { error: string }).error).toMatch(/read-only ISO library/)
    expect(pveFetchMock).not.toHaveBeenCalled()
  })

  it('403: a storage outside the scope keeps the generic refusal', async () => {
    const { POST } = await import('./route')
    const res = await callRoute(POST as Parameters<typeof callRoute>[0], {
      method: 'POST', params, body: { vmid: 100, storage: 'elsewhere' },
    })
    expect(res.status).toBe(403)
    expect(((await res.json()) as { error: string }).error).toMatch(/not authorised/)
  })

  it('the writable storage next to the library reaches the PVE vzdump call', async () => {
    const { POST } = await import('./route')
    const res = await callRoute(POST as Parameters<typeof callRoute>[0], {
      method: 'POST', params, body: { vmid: 100, storage: 'ceph' },
    })
    expect(res.status).toBe(200)
    expect(pveFetchMock).toHaveBeenCalled()
  })

  it('a scope without the writable map keeps every visible storage writable (legacy fixture)', async () => {
    getInfraMock.mockResolvedValue({
      kind: 'iaas',
      vdcScope: { storagesByConnection: new Map([['conn-1', new Set(['ceph', 'isolib'])]]) },
    })
    const { POST } = await import('./route')
    const res = await callRoute(POST as Parameters<typeof callRoute>[0], {
      method: 'POST', params, body: { vmid: 100, storage: 'isolib' },
    })
    expect(res.status).toBe(200)
  })
})
