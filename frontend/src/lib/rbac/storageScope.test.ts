/**
 * Storage scope (issue #921), MOCK-based like checkPermissions.test.ts: a
 * `storage` grant targets `connectionId:storageId` and satisfies a check on
 * that storage only; the perimeter helper reports which storages of a
 * connection a caller may act on.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const m = vi.hoisted(() => ({
  getPrincipal: vi.fn(),
  rejectionToResponse: vi.fn(),
  resolveVmMeta: vi.fn(),
  prisma: {
    rbacUserRole: { findFirst: vi.fn(), findMany: vi.fn() },
    rbacUserPermission: { findMany: vi.fn() },
  } as any,
}))

vi.mock('@/lib/db/prisma', () => ({ prisma: m.prisma }))
vi.mock('@/lib/auth/principal', () => ({
  getPrincipal: (...a: unknown[]) => m.getPrincipal(...a),
  rejectionToResponse: (...a: unknown[]) => m.rejectionToResponse(...a),
}))
vi.mock('@/lib/cache/vmMetaCache', () => ({ resolveVmMeta: (...a: unknown[]) => m.resolveVmMeta(...a) }))
vi.mock('@/lib/cache/inventoryCache', () => ({ getTenantInventoriesFromCache: vi.fn() }))
vi.mock('@/lib/tenant', () => ({ DEFAULT_TENANT_ID: 'default' }))

import {
  buildStorageResourceId,
  checkPermission,
  filterStoragesByGrant,
  getRequestStorageGrantPerimeter,
  getStorageGrantPerimeter,
  PERMISSIONS,
} from './index'

const CONN = 'conn-1'
const LOCAL = buildStorageResourceId(CONN, 'local')
const ISO = buildStorageResourceId(CONN, 'ISO')
const userPrincipal = { ok: true, principal: { kind: 'user', userId: 'u1', tenantId: 't1' } }

type Grant = { permissions: string[]; scopeType: string; scopeTarget?: string | null }

/** Role assignments carrying the given permissions on the given scopes. */
function grantRoles(grants: Grant[]) {
  m.prisma.rbacUserRole.findMany.mockResolvedValue(grants.map(g => ({
    scopeType: g.scopeType,
    scopeTarget: g.scopeTarget ?? null,
    role: { defaultScopes: null, permissions: g.permissions.map(name => ({ permission: { name } })) },
  })))
}

function grantDirect(permission: string, scopeType: string, scopeTarget: string | null) {
  m.prisma.rbacUserPermission.findMany.mockResolvedValue([{ scopeType, scopeTarget, permission: { name: permission } }])
}

const statusOf = (res: Response | null) => (res ? res.status : null)

beforeEach(() => {
  vi.clearAllMocks()
  m.getPrincipal.mockResolvedValue(userPrincipal)
  m.prisma.rbacUserRole.findFirst.mockResolvedValue(null)
  m.prisma.rbacUserRole.findMany.mockResolvedValue([])
  m.prisma.rbacUserPermission.findMany.mockResolvedValue([])
  m.resolveVmMeta.mockReturnValue(null)
})

describe('buildStorageResourceId', () => {
  it('is the connectionId:storageId pair a storage scope stores', () => {
    expect(LOCAL).toBe('conn-1:local')
  })
})

describe('checkPermission on a "storage" resource', () => {
  it('a storage grant opens the storage it names and no other', async () => {
    grantRoles([{ permissions: ['storage.upload'], scopeType: 'storage', scopeTarget: LOCAL }])
    expect(await checkPermission(PERMISSIONS.STORAGE_UPLOAD, 'storage', LOCAL)).toBeNull()
    expect(statusOf(await checkPermission(PERMISSIONS.STORAGE_UPLOAD, 'storage', ISO))).toBe(403)
    // Same pair on another connection: not this grant.
    expect(statusOf(await checkPermission(PERMISSIONS.STORAGE_UPLOAD, 'storage', 'conn-2:local'))).toBe(403)
  })

  it('a storage grant never satisfies a connection, node or vm check', async () => {
    grantRoles([{ permissions: ['storage.upload', 'connection.view', 'vm.view'], scopeType: 'storage', scopeTarget: LOCAL }])
    expect(statusOf(await checkPermission(PERMISSIONS.CONNECTION_VIEW, 'connection', CONN))).toBe(403)
    expect(statusOf(await checkPermission(PERMISSIONS.VM_VIEW, 'node', `${CONN}:local`))).toBe(403)
    expect(statusOf(await checkPermission(PERMISSIONS.VM_VIEW, 'vm', `${CONN}:pve1:qemu:100`))).toBe(403)
  })

  it('a node named like the storage does not open it: the resource type is part of the match', async () => {
    grantRoles([{ permissions: ['storage.upload'], scopeType: 'storage', scopeTarget: `${CONN}:pve1` }])
    expect(statusOf(await checkPermission(PERMISSIONS.STORAGE_UPLOAD, 'node', `${CONN}:pve1`))).toBe(403)
  })

  it('connection and global grants keep covering every storage of the cluster', async () => {
    grantRoles([{ permissions: ['storage.upload'], scopeType: 'connection', scopeTarget: CONN }])
    expect(await checkPermission(PERMISSIONS.STORAGE_UPLOAD, 'storage', LOCAL)).toBeNull()
    expect(await checkPermission(PERMISSIONS.STORAGE_UPLOAD, 'storage', ISO)).toBeNull()
    expect(statusOf(await checkPermission(PERMISSIONS.STORAGE_UPLOAD, 'storage', 'conn-2:local'))).toBe(403)

    grantRoles([{ permissions: ['storage.upload'], scopeType: 'global' }])
    expect(await checkPermission(PERMISSIONS.STORAGE_UPLOAD, 'storage', 'conn-2:local')).toBeNull()
  })

  it('node, vm, tag and pool grants reach no storage', async () => {
    grantRoles([
      { permissions: ['storage.upload'], scopeType: 'node', scopeTarget: `${CONN}:pve1` },
      { permissions: ['storage.upload'], scopeType: 'vm', scopeTarget: `${CONN}:pve1:qemu:100` },
      { permissions: ['storage.upload'], scopeType: 'tag', scopeTarget: 'ops' },
      { permissions: ['storage.upload'], scopeType: 'pool', scopeTarget: 'prod' },
    ])
    expect(statusOf(await checkPermission(PERMISSIONS.STORAGE_UPLOAD, 'storage', LOCAL))).toBe(403)
  })

  it('a direct grant on a storage counts like a role grant', async () => {
    grantDirect('backup.job.create', 'storage', `${CONN}:pbs`)
    expect(await checkPermission(PERMISSIONS.BACKUP_JOB_CREATE, 'storage', `${CONN}:pbs`)).toBeNull()
    expect(statusOf(await checkPermission(PERMISSIONS.BACKUP_JOB_CREATE, 'storage', LOCAL))).toBe(403)
  })

  it('an API token is held to its connection perimeter on a storage resource', async () => {
    m.getPrincipal.mockResolvedValue({
      ok: true,
      principal: { kind: 'token', tokenId: 'tok', tenantId: 'default', permissions: new Set(['storage.upload']), connectionIds: [CONN] },
    })
    expect(await checkPermission(PERMISSIONS.STORAGE_UPLOAD, 'storage', LOCAL)).toBeNull()
    expect(statusOf(await checkPermission(PERMISSIONS.STORAGE_UPLOAD, 'storage', 'conn-2:local'))).toBe(403)
  })
})

describe('getStorageGrantPerimeter', () => {
  it('lists the storages of the connection granted through storage scopes, and only those', async () => {
    grantRoles([
      { permissions: ['storage.upload', 'storage.content'], scopeType: 'storage', scopeTarget: LOCAL },
      { permissions: ['storage.upload'], scopeType: 'storage', scopeTarget: 'conn-2:ISO' },
      { permissions: ['storage.content'], scopeType: 'node', scopeTarget: `${CONN}:pve1` },
    ])
    grantDirect('storage.upload', 'storage', `${CONN}:pbs`)

    const p = await getStorageGrantPerimeter('u1', CONN, 'storage.upload', 't1')
    expect(p.restricted).toBe(true)
    expect([...p.storages].sort((a, b) => a.localeCompare(b))).toEqual(['local', 'pbs'])

    const other = await getStorageGrantPerimeter('u1', CONN, 'storage.delete', 't1')
    expect(other).toEqual({ restricted: true, storages: new Set() })
  })

  it('is unrestricted for a global or connection grant of the permission, for a super admin and for a token', async () => {
    grantRoles([{ permissions: ['storage.upload'], scopeType: 'connection', scopeTarget: CONN }])
    expect((await getStorageGrantPerimeter('u1', CONN, 'storage.upload', 't1')).restricted).toBe(false)
    // The connection grant covers conn-1 only.
    expect((await getStorageGrantPerimeter('u1', 'conn-2', 'storage.upload', 't1')).restricted).toBe(true)

    grantRoles([{ permissions: ['storage.upload'], scopeType: 'global' }])
    expect((await getStorageGrantPerimeter('u1', 'conn-2', 'storage.upload', 't1')).restricted).toBe(false)

    m.prisma.rbacUserRole.findFirst.mockResolvedValue({ id: 'sa' })
    grantRoles([])
    expect((await getStorageGrantPerimeter('u1', CONN, 'storage.upload', 't1')).restricted).toBe(false)

    const token = { kind: 'token', tokenId: 'tok', tenantId: 'default', permissions: new Set(['storage.upload']), connectionIds: [CONN] } as any
    expect((await getStorageGrantPerimeter(token, CONN, 'storage.upload')).restricted).toBe(false)
  })

  it('follows the permission hierarchy: a parent right granted on a storage counts for its children', async () => {
    grantRoles([{ permissions: ['vm.config'], scopeType: 'storage', scopeTarget: LOCAL }])
    const p = await getStorageGrantPerimeter('u1', CONN, 'vm.config.media', 't1')
    expect(p.storages).toEqual(new Set(['local']))
  })

  it('request-scoped: resolves the session user, null without a principal', async () => {
    grantRoles([{ permissions: ['backup.job.create'], scopeType: 'storage', scopeTarget: `${CONN}:pbs` }])
    const p = await getRequestStorageGrantPerimeter(CONN, 'backup.job.create')
    expect(p).toEqual({ restricted: true, storages: new Set(['pbs']) })

    m.getPrincipal.mockResolvedValue({ ok: false, rejection: { kind: 'unauthenticated' } })
    expect(await getRequestStorageGrantPerimeter(CONN, 'backup.job.create')).toBeNull()
  })
})

describe('filterStoragesByGrant', () => {
  const rows = [{ storage: 'local' }, { storage: 'ISO' }, { storage: 'pbs' }]

  it('keeps the whole list for an unrestricted or missing perimeter', () => {
    expect(filterStoragesByGrant(rows, null, r => r.storage)).toEqual(rows)
    expect(filterStoragesByGrant(rows, { restricted: false, storages: new Set() }, r => r.storage)).toEqual(rows)
  })

  it('keeps only the granted storages otherwise, nothing when none is granted', () => {
    expect(filterStoragesByGrant(rows, { restricted: true, storages: new Set(['pbs']) }, r => r.storage)).toEqual([{ storage: 'pbs' }])
    expect(filterStoragesByGrant(rows, { restricted: true, storages: new Set() }, r => r.storage)).toEqual([])
  })
})
