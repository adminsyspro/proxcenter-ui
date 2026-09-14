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
  tenantFindUniqueMock,
  tenantFindManyMock,
} = vi.hoisted(() => ({
  getCurrentTenantIdMock: vi.fn(),
  getTenantInfrastructureScopeMock: vi.fn(),
  getConnectionByIdMock: vi.fn(),
  pveFetchMock: vi.fn(),
  tenantFindUniqueMock: vi.fn(),
  tenantFindManyMock: vi.fn(),
}))

vi.mock('@/lib/tenant', () => ({ getCurrentTenantId: getCurrentTenantIdMock }))
// The upload-library branch of guardTenantStorageWrite resolves file
// ownership through the platform's tenant slugs (loadTenantSlugs ->
// prisma.tenant.findMany); nothing else here touches the DB.
vi.mock('@/lib/db/prisma', () => ({
  prisma: {
    tenant: {
      findUnique: (...a: unknown[]) => tenantFindUniqueMock(...a),
      findMany: (...a: unknown[]) => tenantFindManyMock(...a),
    },
  },
}))
vi.mock('@/lib/tenant/infraScope', () => ({
  getTenantInfrastructureScope: getTenantInfrastructureScopeMock,
}))
vi.mock('@/lib/connections/getConnection', () => ({
  getConnectionById: getConnectionByIdMock,
}))
vi.mock('@/lib/proxmox/client', () => ({ pveFetch: pveFetchMock }))

// Import helpers AFTER mocks are registered
import {
  guardTenantStorageWrite,
  assertVdcPbsAccess,
  resolveUploadOwner,
  tenantUploadFilename,
  isLibraryOnlyStorage,
} from './scope'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeIaasScope(
  connId: string,
  storages: string[],
  pbsNamespaces: Array<{ datastore: string; namespace: string }> = [],
  opts: { writable?: string[]; isoLibraries?: string[]; uploadLibraries?: string[] } = {},
) {
  // Without an explicit `writable` list every visible storage is writable,
  // which is the pre-#894 contract the existing cases rely on.
  return {
    kind: 'iaas' as const,
    vdcScope: {
      storagesByConnection: new Map([[connId, new Set(storages)]]),
      writableStoragesByConnection: new Map([[connId, new Set(opts.writable ?? storages)]]),
      isoLibrariesByConnection: new Map([[connId, new Set(opts.isoLibraries ?? [])]]),
      uploadLibrariesByConnection: new Map([[connId, new Set(opts.uploadLibraries ?? [])]]),
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
      expect(getTenantInfrastructureScopeMock).toHaveBeenCalledWith(expect.any(String), {
        ignoreVdcContext: true,
      })
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

    it('returns 403 for a flag-less zfs storage (shared undefined/0, type "zfs") — same bug class as #569', async () => {
      // The PVE config carries no `shared` flag at all here (as happens for
      // some zfs/rbd/nfs backends), but the storage is inherently shared by
      // type. Before this fix, the flag-only check let this slip through as
      // writable, creating a read/write asymmetry with the canonical
      // isSharedStorage() classification used on the read paths.
      getTenantInfrastructureScopeMock.mockResolvedValue(
        makeIaasScope('conn-1', ['tank-zfs'])
      )
      getConnectionByIdMock.mockResolvedValue({ id: 'conn-1' })
      pveFetchMock.mockResolvedValue({ type: 'zfs' })

      const res = await guardTenantStorageWrite('conn-1', 'tank-zfs')
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

    // #894: a storage the tenant only reaches as an ISO library is visible
    // (CD/DVD picker, content listing) but must never accept an upload or a
    // deletion. The refusal happens BEFORE the PVE shared/non-shared probe.
    it('returns 403 "read-only ISO library" for a library-only storage, without probing PVE', async () => {
      getTenantInfrastructureScopeMock.mockResolvedValue(
        makeIaasScope('conn-1', ['local-zfs', 'isolib'], [], { writable: ['local-zfs'], isoLibraries: ['isolib'] })
      )

      const res = await guardTenantStorageWrite('conn-1', 'isolib')
      expect(res).not.toBeNull()
      expect(res!.status).toBe(403)
      expect((await res!.json()).error).toMatch(/read-only ISO library/)
      expect(pveFetchMock).not.toHaveBeenCalled()
    })

    it('still lets the writable primary storage through next to a library grant', async () => {
      getTenantInfrastructureScopeMock.mockResolvedValue(
        makeIaasScope('conn-1', ['local-zfs', 'isolib'], [], { writable: ['local-zfs'], isoLibraries: ['isolib'] })
      )
      getConnectionByIdMock.mockResolvedValue({ id: 'conn-1' })
      pveFetchMock.mockResolvedValue({ shared: 0 })

      const res = await guardTenantStorageWrite('conn-1', 'local-zfs')
      expect(res).toBeNull()
    })

    // #894 allowUploads: a library that accepts uploads lets the tenant write
    // and delete ITS OWN files only, recognised by the `custom-<slug>-` prefix.
    // The provider catalogue and other tenants' uploads stay untouchable, and
    // the shared-backend probe is skipped (the prefix does the isolation).
    describe('ISO library with uploads allowed', () => {
      const uploadScope = () =>
        makeIaasScope('conn-1', ['local-zfs', 'isolib'], [], {
          writable: ['local-zfs'], isoLibraries: ['isolib'], uploadLibraries: ['isolib'],
        })

      beforeEach(() => {
        // The caller (t-test) is `acme`; no other tenant unless a case adds one.
        tenantFindManyMock.mockReset().mockResolvedValue([{ id: 't-test', slug: 'acme' }])
      })

      it('accepts an own-prefixed filename without probing PVE', async () => {
        getTenantInfrastructureScopeMock.mockResolvedValue(uploadScope())
        const res = await guardTenantStorageWrite('conn-1', 'isolib', { filename: 'custom-acme-rescue.iso' })
        expect(res).toBeNull()
        expect(pveFetchMock).not.toHaveBeenCalled()
      })

      it('accepts a volid-shaped path and judges its basename', async () => {
        getTenantInfrastructureScopeMock.mockResolvedValue(uploadScope())
        const res = await guardTenantStorageWrite('conn-1', 'isolib', { filename: 'iso/custom-acme-rescue.iso' })
        expect(res).toBeNull()
      })

      it("refuses a prefix matching no tenant with the naming message", async () => {
        getTenantInfrastructureScopeMock.mockResolvedValue(uploadScope())
        const res = await guardTenantStorageWrite('conn-1', 'isolib', { filename: 'custom-other-x.iso' })
        expect(res!.status).toBe(403)
        expect((await res!.json()).error).toMatch(/custom-acme-/)
      })

      it("refuses another tenant's file and names that tenant's namespace", async () => {
        tenantFindManyMock.mockResolvedValue([{ id: 't-test', slug: 'acme' }, { id: 't-other', slug: 'other' }])
        getTenantInfrastructureScopeMock.mockResolvedValue(uploadScope())
        const res = await guardTenantStorageWrite('conn-1', 'isolib', { filename: 'custom-other-x.iso' })
        expect(res!.status).toBe(403)
        expect((await res!.json()).error).toMatch(/another tenant's namespace \(custom-other-\)/)
      })

      it('resolves ownership on the LONGEST slug: acme may not touch custom-acme-prod-x.iso', async () => {
        tenantFindManyMock.mockResolvedValue([{ id: 't-test', slug: 'acme' }, { id: 't-prod', slug: 'acme-prod' }])
        getTenantInfrastructureScopeMock.mockResolvedValue(uploadScope())
        const res = await guardTenantStorageWrite('conn-1', 'isolib', { filename: 'custom-acme-prod-x.iso' })
        expect(res!.status).toBe(403)
        expect((await res!.json()).error).toMatch(/custom-acme-prod-/)
        // ...while acme-prod itself is accepted
        getCurrentTenantIdMock.mockResolvedValue('t-prod')
        expect(await guardTenantStorageWrite('conn-1', 'isolib', { filename: 'custom-acme-prod-x.iso' })).toBeNull()
      })

      it('only ISO content may be written to a library', async () => {
        getTenantInfrastructureScopeMock.mockResolvedValue(uploadScope())
        const res = await guardTenantStorageWrite('conn-1', 'isolib', { filename: 'custom-acme-tpl.tar.gz', content: 'vztmpl' })
        expect(res!.status).toBe(403)
        expect((await res!.json()).error).toMatch(/Only ISO images/)
        expect(await guardTenantStorageWrite('conn-1', 'isolib', { filename: 'custom-acme-x.iso', content: 'iso' })).toBeNull()
      })

      it('refuses an unprefixed filename (would masquerade as provider catalogue)', async () => {
        getTenantInfrastructureScopeMock.mockResolvedValue(uploadScope())
        const res = await guardTenantStorageWrite('conn-1', 'isolib', { filename: 'debian.iso' })
        expect(res!.status).toBe(403)
        expect((await res!.json()).error).toMatch(/custom-acme-/)
      })

      it('fails closed when the caller cannot name the file', async () => {
        getTenantInfrastructureScopeMock.mockResolvedValue(uploadScope())
        const res = await guardTenantStorageWrite('conn-1', 'isolib')
        expect(res!.status).toBe(403)
        expect((await res!.json()).error).toMatch(/read-only ISO library/)
      })

      it('falls back to the tenant id when the tenant has no slug', async () => {
        tenantFindManyMock.mockResolvedValue([])
        getCurrentTenantIdMock.mockResolvedValue('T-Test_1')
        getTenantInfrastructureScopeMock.mockResolvedValue(uploadScope())
        expect(await guardTenantStorageWrite('conn-1', 'isolib', { filename: 'custom-t-test1-x.iso' })).toBeNull()
        expect((await guardTenantStorageWrite('conn-1', 'isolib', { filename: 'custom-acme-x.iso' }))!.status).toBe(403)
      })

      it('keeps a plain (read-only) library refused even for an own-prefixed filename', async () => {
        getTenantInfrastructureScopeMock.mockResolvedValue(
          makeIaasScope('conn-1', ['local-zfs', 'isolib'], [], { writable: ['local-zfs'], isoLibraries: ['isolib'] })
        )
        const res = await guardTenantStorageWrite('conn-1', 'isolib', { filename: 'custom-acme-rescue.iso' })
        expect(res!.status).toBe(403)
        expect((await res!.json()).error).toMatch(/read-only ISO library/)
        expect(tenantFindManyMock).not.toHaveBeenCalled()
      })
    })
  })
})

// ===========================================================================
// resolveUploadOwner (pure)
// ===========================================================================

describe('resolveUploadOwner', () => {
  const slugs = ['acme', 'acme-prod', 'other']

  it('a file without the custom- prefix is the provider catalogue', () => {
    expect(resolveUploadOwner('debian-13.iso', slugs)).toEqual({ kind: 'provider' })
    expect(resolveUploadOwner('lib:iso/debian-13.iso', slugs)).toEqual({ kind: 'provider' })
  })

  it('the LONGEST matching slug owns the file', () => {
    expect(resolveUploadOwner('custom-acme-x.iso', slugs)).toEqual({ kind: 'tenant', slug: 'acme' })
    expect(resolveUploadOwner('custom-acme-prod-x.iso', slugs)).toEqual({ kind: 'tenant', slug: 'acme-prod' })
    expect(resolveUploadOwner('custom-acme-prod-x.iso', ['acme-prod', 'acme'])).toEqual({ kind: 'tenant', slug: 'acme-prod' })
  })

  it('a custom- prefix matching no tenant is unknown, never provider', () => {
    expect(resolveUploadOwner('custom-nobody-x.iso', slugs)).toEqual({ kind: 'unknown' })
    expect(resolveUploadOwner('custom-acme', slugs)).toEqual({ kind: 'unknown' })
  })

  it('judges the basename of a volid-shaped input', () => {
    expect(resolveUploadOwner('isolib:iso/custom-other-x.iso', slugs)).toEqual({ kind: 'tenant', slug: 'other' })
  })
})

// ===========================================================================
// tenantUploadFilename + isLibraryOnlyStorage
// ===========================================================================

describe('tenantUploadFilename', () => {
  const scope = () =>
    makeIaasScope('conn-1', ['ceph', 'isolib', 'rolib'], [], {
      writable: ['ceph'], isoLibraries: ['isolib', 'rolib'], uploadLibraries: ['isolib'],
    })

  beforeEach(() => {
    tenantFindManyMock.mockReset().mockResolvedValue([{ id: 't-test', slug: 'acme' }, { id: 't-other', slug: 'other' }])
  })

  it('leaves the name alone for the provider and for MSP tenants', async () => {
    getTenantInfrastructureScopeMock.mockResolvedValue({ kind: 'provider' })
    expect(await tenantUploadFilename('conn-1', 'isolib', 'debian.iso')).toBe('debian.iso')
    getTenantInfrastructureScopeMock.mockResolvedValue({ kind: 'msp', connectionIds: new Set(['conn-1']) })
    expect(await tenantUploadFilename('conn-1', 'isolib', 'debian.iso')).toBe('debian.iso')
    expect(tenantFindManyMock).not.toHaveBeenCalled()
  })

  it('leaves the name alone on a writable storage and on a read-only library', async () => {
    getTenantInfrastructureScopeMock.mockResolvedValue(scope())
    expect(await tenantUploadFilename('conn-1', 'ceph', 'debian.iso')).toBe('debian.iso')
    expect(await tenantUploadFilename('conn-1', 'rolib', 'debian.iso')).toBe('debian.iso')
  })

  it('on an upload library: keeps an own-prefixed name, namespaces a raw one', async () => {
    getTenantInfrastructureScopeMock.mockResolvedValue(scope())
    expect(await tenantUploadFilename('conn-1', 'isolib', 'custom-acme-x.iso')).toBe('custom-acme-x.iso')
    expect(await tenantUploadFilename('conn-1', 'isolib', 'iso/custom-acme-x.iso')).toBe('custom-acme-x.iso')
    expect(await tenantUploadFilename('conn-1', 'isolib', 'debian.iso')).toBe('custom-acme-debian.iso')
  })

  it("on an upload library: another tenant's prefix is namespaced too, never impersonated", async () => {
    getTenantInfrastructureScopeMock.mockResolvedValue(scope())
    expect(await tenantUploadFilename('conn-1', 'isolib', 'custom-other-x.iso')).toBe('custom-acme-custom-other-x.iso')
    expect(await tenantUploadFilename('conn-1', 'isolib', 'custom-nobody-x.iso')).toBe('custom-acme-custom-nobody-x.iso')
  })
})

describe('isLibraryOnlyStorage', () => {
  it('is true only for a library the tenant cannot otherwise write to', () => {
    const s = makeIaasScope('conn-1', ['ceph', 'isolib', 'both'], [], {
      writable: ['ceph', 'both'], isoLibraries: ['isolib', 'both'],
    }).vdcScope as any
    expect(isLibraryOnlyStorage(s, 'conn-1', 'isolib')).toBe(true)
    expect(isLibraryOnlyStorage(s, 'conn-1', 'both')).toBe(false)
    expect(isLibraryOnlyStorage(s, 'conn-1', 'ceph')).toBe(false)
    expect(isLibraryOnlyStorage(s, 'conn-1', 'nope')).toBe(false)
  })

  it('a scope without the library map never flags anything', () => {
    const legacy = { storagesByConnection: new Map([['conn-1', new Set(['isolib'])]]) } as any
    expect(isLibraryOnlyStorage(legacy, 'conn-1', 'isolib')).toBe(false)
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
      expect(getTenantInfrastructureScopeMock).toHaveBeenCalledWith(expect.any(String), {
        ignoreVdcContext: true,
      })
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
