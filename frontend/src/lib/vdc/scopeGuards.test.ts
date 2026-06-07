/**
 * MOCK-based tests for the tri-modal MSP/iaas/provider branches in
 * guardTenantStorageWrite and assertVdcPbsAccess.
 *
 * These helpers reach getTenantInfrastructureScope which hits prisma, so we
 * mock all dynamic-import deps via vi.hoisted() and vi.mock(). No real DB.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// ---------------------------------------------------------------------------
// Hoist mock fns so they are available before vi.mock() factory runs
// ---------------------------------------------------------------------------
const {
  getCurrentTenantIdMock,
  getTenantInfrastructureScopeMock,
  getConnectionByIdMock,
  pveFetchMock,
} = vi.hoisted(() => ({
  getCurrentTenantIdMock: vi.fn(),
  getTenantInfrastructureScopeMock: vi.fn(),
  getConnectionByIdMock: vi.fn(),
  pveFetchMock: vi.fn(),
}))

vi.mock('@/lib/tenant', () => ({ getCurrentTenantId: getCurrentTenantIdMock }))
vi.mock('@/lib/tenant/infraScope', () => ({
  getTenantInfrastructureScope: getTenantInfrastructureScopeMock,
}))
vi.mock('@/lib/connections/getConnection', () => ({
  getConnectionById: getConnectionByIdMock,
}))
vi.mock('@/lib/proxmox/client', () => ({ pveFetch: pveFetchMock }))

// Import helpers AFTER mocks are registered
import { guardTenantStorageWrite, assertVdcPbsAccess } from './scope'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeIaasScope(
  connId: string,
  storages: string[],
  pbsNamespaces: Array<{ datastore: string; namespace: string }> = []
) {
  return {
    kind: 'iaas' as const,
    vdcScope: {
      storagesByConnection: new Map([[connId, new Set(storages)]]),
      pbsNamespacesByConnection: new Map([[connId, pbsNamespaces]]),
    },
  }
}

// ---------------------------------------------------------------------------
// beforeEach: reset all mocks
// ---------------------------------------------------------------------------

beforeEach(() => {
  getCurrentTenantIdMock.mockReset()
  getTenantInfrastructureScopeMock.mockReset()
  getConnectionByIdMock.mockReset()
  pveFetchMock.mockReset()
  // Default: tenant id resolves to something
  getCurrentTenantIdMock.mockResolvedValue('t-test')
})

// ===========================================================================
// guardTenantStorageWrite
// ===========================================================================

describe('guardTenantStorageWrite', () => {
  describe('provider', () => {
    it('passes through (returns null) without any storage check', async () => {
      getTenantInfrastructureScopeMock.mockResolvedValue({ kind: 'provider' })
      const res = await guardTenantStorageWrite('conn-1', 'local-zfs')
      expect(res).toBeNull()
      expect(pveFetchMock).not.toHaveBeenCalled()
    })
  })

  describe('msp', () => {
    it('returns null when the connId is owned by the MSP tenant', async () => {
      getTenantInfrastructureScopeMock.mockResolvedValue({
        kind: 'msp',
        connectionIds: new Set(['conn-1', 'conn-2']),
      })
      const res = await guardTenantStorageWrite('conn-1', 'cephfs-shared')
      // MSP owns the whole cluster, shared storages are fine
      expect(res).toBeNull()
      expect(pveFetchMock).not.toHaveBeenCalled()
    })

    it('returns 403 when the connId is NOT owned by the MSP tenant', async () => {
      getTenantInfrastructureScopeMock.mockResolvedValue({
        kind: 'msp',
        connectionIds: new Set(['conn-2']),
      })
      const res = await guardTenantStorageWrite('conn-1', 'local-zfs')
      expect(res).not.toBeNull()
      expect(res!.status).toBe(403)
    })
  })

  describe('iaas', () => {
    it('returns null when storage is in scope and backend is non-shared', async () => {
      getTenantInfrastructureScopeMock.mockResolvedValue(
        makeIaasScope('conn-1', ['local-zfs'])
      )
      getConnectionByIdMock.mockResolvedValue({ id: 'conn-1' })
      pveFetchMock.mockResolvedValue({ shared: 0 })

      const res = await guardTenantStorageWrite('conn-1', 'local-zfs')
      expect(res).toBeNull()
    })

    it('returns 403 when storage is in scope but backend is shared (shared=1)', async () => {
      getTenantInfrastructureScopeMock.mockResolvedValue(
        makeIaasScope('conn-1', ['cephfs'])
      )
      getConnectionByIdMock.mockResolvedValue({ id: 'conn-1' })
      pveFetchMock.mockResolvedValue({ shared: 1 })

      const res = await guardTenantStorageWrite('conn-1', 'cephfs')
      expect(res).not.toBeNull()
      expect(res!.status).toBe(403)
    })

    it('returns 403 when storage is NOT in scope for this connection', async () => {
      getTenantInfrastructureScopeMock.mockResolvedValue(
        makeIaasScope('conn-1', ['local-zfs'])
      )

      const res = await guardTenantStorageWrite('conn-1', 'nfs-shared')
      expect(res).not.toBeNull()
      expect(res!.status).toBe(403)
      expect(pveFetchMock).not.toHaveBeenCalled()
    })

    it('returns 403 when the connection is not in scope at all', async () => {
      getTenantInfrastructureScopeMock.mockResolvedValue(
        makeIaasScope('conn-other', ['local-zfs'])
      )

      const res = await guardTenantStorageWrite('conn-1', 'local-zfs')
      expect(res).not.toBeNull()
      expect(res!.status).toBe(403)
    })

    it('returns 403 when pveFetch throws (storage unreachable)', async () => {
      getTenantInfrastructureScopeMock.mockResolvedValue(
        makeIaasScope('conn-1', ['local-zfs'])
      )
      getConnectionByIdMock.mockResolvedValue({ id: 'conn-1' })
      pveFetchMock.mockRejectedValue(new Error('timeout'))

      const res = await guardTenantStorageWrite('conn-1', 'local-zfs')
      expect(res).not.toBeNull()
      expect(res!.status).toBe(403)
    })
  })
})

// ===========================================================================
// assertVdcPbsAccess
// ===========================================================================

describe('assertVdcPbsAccess', () => {
  describe('provider', () => {
    it('returns {kind: admin}', async () => {
      getTenantInfrastructureScopeMock.mockResolvedValue({ kind: 'provider' })
      const result = await assertVdcPbsAccess('pbs-1')
      expect(result).toEqual({ kind: 'admin' })
    })
  })

  describe('msp', () => {
    it('returns {kind: admin} when the connId is owned by the MSP tenant', async () => {
      getTenantInfrastructureScopeMock.mockResolvedValue({
        kind: 'msp',
        connectionIds: new Set(['pbs-1', 'pbs-2']),
      })
      const result = await assertVdcPbsAccess('pbs-1')
      expect(result).toEqual({ kind: 'admin' })
    })

    it('returns 403 when the connId is NOT owned by the MSP tenant', async () => {
      getTenantInfrastructureScopeMock.mockResolvedValue({
        kind: 'msp',
        connectionIds: new Set(['pbs-2']),
      })
      const result = await assertVdcPbsAccess('pbs-1')
      expect(result).toBeInstanceOf(Response)
      expect((result as Response).status).toBe(403)
    })
  })

  describe('iaas', () => {
    const namespaces = [
      { datastore: 'ds1', namespace: 'ns-tenant' },
      { datastore: 'ds1', namespace: 'ns-tenant-2' },
    ]

    it('returns {kind: tenant, allowed} when the connection has PBS namespaces', async () => {
      getTenantInfrastructureScopeMock.mockResolvedValue(
        makeIaasScope('pbs-1', [], namespaces)
      )
      const result = await assertVdcPbsAccess('pbs-1')
      expect(result).toEqual({ kind: 'tenant', allowed: namespaces })
    })

    it('returns 403 when the connection has no PBS namespaces', async () => {
      getTenantInfrastructureScopeMock.mockResolvedValue(
        makeIaasScope('pbs-1', [], [])
      )
      const result = await assertVdcPbsAccess('pbs-1')
      expect(result).toBeInstanceOf(Response)
      expect((result as Response).status).toBe(403)
    })

    it('returns 403 when the PBS connId is not in scope at all', async () => {
      getTenantInfrastructureScopeMock.mockResolvedValue(
        makeIaasScope('pbs-other', [], namespaces)
      )
      const result = await assertVdcPbsAccess('pbs-1')
      expect(result).toBeInstanceOf(Response)
      expect((result as Response).status).toBe(403)
    })
  })
})
