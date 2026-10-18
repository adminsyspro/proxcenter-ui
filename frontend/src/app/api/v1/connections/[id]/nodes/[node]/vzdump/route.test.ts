/**
 * POST /api/v1/connections/[id]/nodes/[node]/vzdump: the backup destination
 * is a WRITE, judged on the tenant's writable storages (#894). A read-only
 * ISO library the tenant can see is never a valid vzdump target.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

// The API token guard is covered by routeGuard.test.ts and writeContract.test.ts:
// pass-through so this file keeps testing the handler, as for a session caller.
vi.mock('@/lib/api-tokens/routeGuard', () => ({
  withPublicApiGuard: (_entryId: string, handler: any) => handler,
}))

import { callRoute } from '@/__tests__/setup/route-test'

const { checkPermissionMock, getCurrentTenantIdMock, getInfraMock, getConnectionByIdMock, pveFetchMock } = vi.hoisted(() => ({
  checkPermissionMock: vi.fn(),
  getCurrentTenantIdMock: vi.fn(),
  getInfraMock: vi.fn(),
  getConnectionByIdMock: vi.fn(),
  pveFetchMock: vi.fn(),
}))

vi.mock('@/lib/rbac', () => ({
  // Storage-scope helpers (#921): the id builder is the real shape, the
  // perimeter is unrestricted unless a test overrides it.
  buildStorageResourceId: (id: string, storage: string) => `${id}:${storage}`,
  getRequestStorageGrantPerimeter: async () => null,
  filterStoragesByGrant: (items: any[], p: any, of: (i: any) => string) => (p?.restricted ? items.filter((i: any) => p.storages.has(of(i))) : items),
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

describe('POST vzdump: destination judged on the storage (#921)', () => {
  it('checks vm.backup on the node AND on the storage, refusing a destination outside the grant', async () => {
    getInfraMock.mockResolvedValue({ kind: 'provider' })
    checkPermissionMock.mockImplementation(async (_p: string, type: string, id: string) =>
      type === 'storage' && id !== 'conn-1:pbs' ? Response.json({ error: 'Permission denied: vm.backup' }, { status: 403 }) : null)
    const { POST } = await import('./route')

    const refused = await callRoute(POST as any, { params, method: 'POST', body: { vmid: 100, storage: 'local' } })
    expect(refused.status).toBe(403)
    expect(pveFetchMock).not.toHaveBeenCalled()

    const allowed = await callRoute(POST as any, { params, method: 'POST', body: { vmid: 100, storage: 'pbs' } })
    expect(allowed.status).toBe(200)
    expect(checkPermissionMock).toHaveBeenCalledWith('vm.backup', 'node', 'conn-1:pve1')
    expect(checkPermissionMock).toHaveBeenCalledWith('vm.backup', 'storage', 'conn-1:pbs')
  })
})
