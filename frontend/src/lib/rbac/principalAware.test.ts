import { describe, expect, it, vi, beforeEach } from 'vitest'

const { headersMock, getServerSessionMock } = vi.hoisted(() => ({
  headersMock: vi.fn<() => Promise<Headers>>(),
  getServerSessionMock: vi.fn<() => Promise<any>>(),
}))

vi.mock('next/headers', () => ({ headers: headersMock }))
vi.mock('next-auth', () => ({ getServerSession: getServerSessionMock }))
vi.mock('@/lib/auth/config', () => ({ authOptions: {} }))

import { prismaTest, truncate } from '@/__tests__/setup/prisma-test'
import {
  ENTERPRISE_WITH_API_ACCESS,
  seedApiToken,
  seedDefaultTenant,
  tokenHeaders,
} from '@/__tests__/setup/apiTokens'
import { _impl } from '@/lib/auth/requireEnterprise'
import { _resetLicenseVerdictCache } from '@/lib/api-tokens/licenseGate'
import { _resetRateLimitCounters } from '@/lib/api-tokens/rateLimit'
import { setCachedInventory } from '@/lib/cache/inventoryCache'
import type { Principal } from '@/lib/auth/principal'
import {
  checkPermission,
  getRBACContext,
  getEffectivePermissions,
  filterVmsByPermission,
  filterNodesByPermission,
  getRbacInfraScope,
  getCurrentRbacInfraScope,
  PERMISSIONS,
} from './index'
import { tokenInfraScope } from './infraScope'

function tokenPrincipal(overrides: Partial<Principal> = {}): Principal {
  return {
    kind: 'token',
    tokenId: 'tok_x',
    tenantId: 'default',
    permissions: new Set(['vm.view', 'node.view', 'connection.view', 'backup.view']),
    connectionIds: ['conn-1'],
    ...overrides,
  }
}

beforeEach(async () => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
  _resetLicenseVerdictCache()
  _resetRateLimitCounters()
  vi.spyOn(_impl, 'getServerLicense').mockResolvedValue(ENTERPRISE_WITH_API_ACCESS)
  headersMock.mockResolvedValue(new Headers())
  getServerSessionMock.mockResolvedValue(null)
  await truncate(['api_tokens', 'tenants', 'users', 'rbac_permissions'])
  await seedDefaultTenant()
})

describe('browser regression: no Authorization Bearer pxc_ means bit-for-bit behavior', () => {
  it('checkPermission returns the existing 401 without a session', async () => {
    const res = await checkPermission(PERMISSIONS.VM_VIEW)
    expect(res?.status).toBe(401)
    expect(await res?.json()).toEqual({ error: 'Not authenticated' })
  })

  it('checkPermission returns the existing 403 body for a grantless session user', async () => {
    getServerSessionMock.mockResolvedValue({ user: { id: 'user-norant', tenantId: 'default' } })
    const res = await checkPermission(PERMISSIONS.VM_VIEW)
    expect(res?.status).toBe(403)
    expect(await res?.json()).toEqual({ error: 'Permission denied: vm.view' })
  })

  it('getRBACContext returns null without a session and the userId shape with one', async () => {
    expect(await getRBACContext()).toBeNull()
    getServerSessionMock.mockResolvedValue({ user: { id: 'user-1', tenantId: 'default' } })
    const ctx = await getRBACContext()
    expect(ctx?.userId).toBe('user-1')
    expect(ctx?.isAdmin).toBe(false)
    expect(ctx?.tenantId).toBe('default')
  })
})

describe('session regression: two-pass tag/pool scopes are unchanged', () => {
  // Real pipeline, no mocks: grants live in Postgres, the VM meta comes from
  // the in-memory inventory cache that resolveVmMeta reads (pass 2).
  const primeInventory = () =>
    setCachedInventory({
      // storages must be present or getInventoryFromCache reports a miss.
      storages: [],
      clusters: [
        {
          id: 'conn-1',
          nodes: [
            {
              node: 'node1',
              guests: [
                { type: 'qemu', vmid: 100, tags: 'prod;web' },
                { type: 'qemu', vmid: 101, tags: 'dev' },
                { type: 'qemu', vmid: 102, pool: 'gold' },
              ],
            },
          ],
        },
      ],
    } as any, 'default')

  async function seedScopedGrant(scopeType: 'tag' | 'pool', scopeTarget: string) {
    const now = new Date()
    await prismaTest.user.create({
      data: { id: 'user-scoped', email: 'scoped@test.local', createdAt: now, updatedAt: now },
    })
    await prismaTest.rbacPermission.create({
      data: { id: 'perm_vm_view', name: PERMISSIONS.VM_VIEW, category: 'vm' },
    })
    await prismaTest.rbacUserPermission.create({
      data: {
        id: 'grant-scoped',
        userId: 'user-scoped',
        permissionId: 'perm_vm_view',
        scopeType,
        scopeTarget,
        tenantId: 'default',
        grantedAt: now,
      },
    })
    getServerSessionMock.mockResolvedValue({ user: { id: 'user-scoped', tenantId: 'default' } })
  }

  it('a tag-scoped grant passes on the second pass for a matching VM', async () => {
    await seedScopedGrant('tag', 'prod')
    primeInventory()
    expect(await checkPermission(PERMISSIONS.VM_VIEW, 'vm', 'conn-1:node1:qemu:100')).toBeNull()
  })

  it('a tag-scoped grant still denies a VM without the tag, unchanged body', async () => {
    await seedScopedGrant('tag', 'prod')
    primeInventory()
    const res = await checkPermission(PERMISSIONS.VM_VIEW, 'vm', 'conn-1:node1:qemu:101')
    expect(res?.status).toBe(403)
    expect(await res?.json()).toEqual({ error: 'Permission denied: vm.view' })
  })

  it('a pool-scoped grant passes on the second pass for a VM in the pool', async () => {
    await seedScopedGrant('pool', 'gold')
    primeInventory()
    expect(await checkPermission(PERMISSIONS.VM_VIEW, 'vm', 'conn-1:node1:qemu:102')).toBeNull()
  })
})

describe('checkPermission, token branch (layer 2)', () => {
  // The allowlist entry must accept the token's scopes (getPrincipal step 10
  // runs before checkPermission ever sees the principal), so backups-scoped
  // tokens enter through the public-backups entry instead of vms-list.
  async function withToken(
    opts: Parameters<typeof seedApiToken>[0],
    entryId = 'vms-list',
    path = '/api/v1/vms',
  ) {
    const seeded = await seedApiToken(opts)
    headersMock.mockResolvedValue(tokenHeaders(seeded.secret, entryId, path))
    return seeded
  }

  it('grants a permission carried by the scopes, no DB grants loaded', async () => {
    await withToken({ scopes: ['vms:read'] })
    expect(await checkPermission(PERMISSIONS.VM_VIEW)).toBeNull()
  })

  it('denies a permission outside the scopes with the unchanged body', async () => {
    await withToken({ scopes: ['vms:read'] })
    const res = await checkPermission(PERMISSIONS.STORAGE_VIEW)
    expect(res?.status).toBe(403)
    expect(await res?.json()).toEqual({ error: 'Permission denied: storage.view' })
  })

  it('interprets "pbs" resourceId as a RAW connection id against connectionIds', async () => {
    await withToken(
      { scopes: ['backups:read'], connectionIds: ['conn-1'] },
      'public-backups',
      '/api/v1/public/backups',
    )
    expect(await checkPermission(PERMISSIONS.BACKUP_VIEW, 'pbs', 'conn-1')).toBeNull()
    const denied = await checkPermission(PERMISSIONS.BACKUP_VIEW, 'pbs', 'conn-2')
    expect(denied?.status).toBe(403)
  })

  it('interprets "vm" resourceId as a PREFIXED id, exact first-segment match', async () => {
    await withToken({ scopes: ['vms:read'], connectionIds: ['conn-1'] })
    expect(await checkPermission(PERMISSIONS.VM_VIEW, 'vm', 'conn-1:node1:qemu:100')).toBeNull()
    const denied = await checkPermission(PERMISSIONS.VM_VIEW, 'vm', 'conn-10:node1:qemu:100')
    expect(denied?.status).toBe(403)
  })

  it('null connectionIds means every connection of the tenant', async () => {
    await withToken({ scopes: ['vms:read'], connectionIds: null })
    expect(await checkPermission(PERMISSIONS.VM_VIEW, 'vm', 'anyconn:node:qemu:1')).toBeNull()
  })

  it('fails CLOSED on a resource-bearing id whose connection segment is unresolvable', async () => {
    await withToken({ scopes: ['vms:read', 'nodes:read'], connectionIds: ['conn-1'] })
    const deniedVm = await checkPermission(PERMISSIONS.VM_VIEW, 'vm', ':node1:qemu:100')
    expect(deniedVm?.status).toBe(403)
    expect(await deniedVm?.json()).toEqual({ error: 'Permission denied: vm.view' })
    const deniedNode = await checkPermission(PERMISSIONS.NODE_VIEW, 'node', ':node1')
    expect(deniedNode?.status).toBe(403)
  })

  it('still allows global and resource-less checks for a connection-scoped token', async () => {
    await withToken({ scopes: ['vms:read'], connectionIds: ['conn-1'] })
    expect(await checkPermission(PERMISSIONS.VM_VIEW)).toBeNull()
    expect(await checkPermission(PERMISSIONS.VM_VIEW, 'global')).toBeNull()
  })

  it('interprets "connection" resourceId as a RAW connection id too, never split on ":"', async () => {
    // resolveTokenConnectionId special-cases "connection" and "pbs" as
    // already-raw ids: unlike "vm"/"node" they must NEVER be split on ":",
    // or a connection id that happens to contain a colon would resolve to
    // the wrong (truncated) segment. Using a colon-bearing id here is the
    // point: a buggy split-based implementation would truncate it to "conn"
    // and still (wrongly) match the "conn" perimeter entry below.
    await withToken(
      { scopes: ['nodes:read'], connectionIds: ['conn:with:colons'] },
      'inventory-tree',
      '/api/v1/inventory',
    )
    expect(await checkPermission(PERMISSIONS.CONNECTION_VIEW, 'connection', 'conn:with:colons')).toBeNull()
    const denied = await checkPermission(PERMISSIONS.CONNECTION_VIEW, 'connection', 'conn')
    expect(denied?.status).toBe(403)
  })

  it('maps an invalid Bearer to the fail-closed 401 response', async () => {
    headersMock.mockResolvedValue(new Headers({ authorization: 'Bearer pxc_invalid-token' }))
    const res = await checkPermission(PERMISSIONS.VM_VIEW)
    expect(res?.status).toBe(401)
    expect(await res?.json()).toEqual({ error: 'Invalid or expired API token' })
  })

  it('getRBACContext for a token carries the principal and NEVER a synthetic userId', async () => {
    await withToken({ scopes: ['vms:read'], connectionIds: ['conn-1'] })
    const ctx = await getRBACContext()
    expect(ctx?.userId).toBeUndefined()
    expect(ctx?.isAdmin).toBe(false)
    expect(ctx?.tenantId).toBe('default')
    expect(ctx?.principal?.kind).toBe('token')
  })
})

describe('token-aware filters (never a synthetic userId)', () => {
  const vms = [
    { id: 'conn-1:qemu:node1:100', connId: 'conn-1', node: 'node1', type: 'qemu', vmid: '100' },
    { id: 'conn-10:qemu:node1:200', connId: 'conn-10', node: 'node1', type: 'qemu', vmid: '200' },
    { id: 'conn-2:lxc:node2:300', connId: 'conn-2', node: 'node2', type: 'lxc', vmid: '300' },
  ]

  it('filterVmsByPermission keeps only exact connection matches', async () => {
    const out = await filterVmsByPermission(tokenPrincipal(), vms, PERMISSIONS.VM_VIEW)
    expect(out.map(v => v.connId)).toEqual(['conn-1'])
  })

  it('filterVmsByPermission returns [] when the permission is not in the scopes', async () => {
    const out = await filterVmsByPermission(
      tokenPrincipal({ permissions: new Set(['storage.view']) }), vms, PERMISSIONS.VM_VIEW,
    )
    expect(out).toEqual([])
  })

  it('filterVmsByPermission returns everything for a null perimeter', async () => {
    const out = await filterVmsByPermission(tokenPrincipal({ connectionIds: null }), vms, PERMISSIONS.VM_VIEW)
    expect(out).toHaveLength(3)
  })

  it('filterVmsByPermission derives connId from the wire id when the vm has none of its own', async () => {
    // Some callers pass raw wire objects without a `connId` field; the
    // token branch must fall back to the first segment of `id` rather than
    // treating a missing connId as "no connection" and dropping the VM.
    const idOnly = [
      { id: 'conn-1:qemu:node1:100' },
      { id: 'conn-2:qemu:node2:200' },
    ]
    const out = await filterVmsByPermission(tokenPrincipal(), idOnly, PERMISSIONS.VM_VIEW)
    expect(out).toEqual([{ id: 'conn-1:qemu:node1:100' }])
  })

  it('filterVmsByPermission drops a vm with neither connId nor id, rather than crashing', async () => {
    const noIdentity = [{ vmid: '999' }]
    const out = await filterVmsByPermission(tokenPrincipal(), noIdentity, PERMISSIONS.VM_VIEW)
    expect(out).toEqual([])
  })

  it('filterNodesByPermission filters by exact connId', async () => {
    const nodes = [
      { connId: 'conn-1', node: 'n1' },
      { connId: 'conn-10', node: 'n1' },
    ]
    const out = await filterNodesByPermission(tokenPrincipal(), nodes, PERMISSIONS.NODE_VIEW)
    expect(out).toEqual([{ connId: 'conn-1', node: 'n1' }])
  })

  it('filterNodesByPermission returns [] when the permission is not in the scopes', async () => {
    const nodes = [{ connId: 'conn-1', node: 'n1' }]
    const out = await filterNodesByPermission(
      tokenPrincipal({ permissions: new Set(['storage.view']) }), nodes, PERMISSIONS.NODE_VIEW,
    )
    expect(out).toEqual([])
  })

  it('filterNodesByPermission returns every node for a null perimeter', async () => {
    const nodes = [
      { connId: 'conn-1', node: 'n1' },
      { connId: 'conn-99', node: 'n2' },
    ]
    const out = await filterNodesByPermission(tokenPrincipal({ connectionIds: null }), nodes, PERMISSIONS.NODE_VIEW)
    expect(out).toHaveLength(2)
  })

  it('getEffectivePermissions returns [] for a token whose permissions are unset, rather than throwing', async () => {
    const perms = await getEffectivePermissions(tokenPrincipal({ permissions: undefined }))
    expect(perms).toEqual([])
  })

  it('getRbacInfraScope maps connectionIds to fullConnections, null to unrestricted', async () => {
    expect(await getRbacInfraScope(tokenPrincipal({ connectionIds: null }))).toBeNull()
    const scope = await getRbacInfraScope(tokenPrincipal())
    expect(scope?.fullConnections).toEqual(new Set(['conn-1']))
    expect(scope?.nodesByConnection.size).toBe(0)
  })

  it('tokenInfraScope is the pure helper behind it', () => {
    expect(tokenInfraScope(null)).toBeNull()
    expect(tokenInfraScope(['a'])?.fullConnections).toEqual(new Set(['a']))
  })

  it('getEffectivePermissions returns the flat scope permission set for a token', async () => {
    const perms = await getEffectivePermissions(tokenPrincipal())
    expect(new Set(perms)).toEqual(new Set(['vm.view', 'node.view', 'connection.view', 'backup.view']))
  })
})

describe('hard gate 2: an omitted tenantId falls back to the PRINCIPAL tenant, never DEFAULT_TENANT_ID', () => {
  // A default-tenant grant would never distinguish the bug (which lands on
  // 'default' as its wrong fallback) from correct behaviour, so every grant
  // here lives under a non-default tenant on purpose.
  const NON_DEFAULT_TENANT = 'tenant-msp-gate2'

  async function seedConnectionScopedGrant() {
    const now = new Date()
    await prismaTest.user.create({
      data: { id: 'user-msp-gate2', email: 'msp-gate2@test.local', createdAt: now, updatedAt: now },
    })
    await prismaTest.rbacPermission.createMany({
      data: [
        { id: 'perm_vm_view_gate2', name: PERMISSIONS.VM_VIEW, category: 'vm' },
        { id: 'perm_node_view_gate2', name: PERMISSIONS.NODE_VIEW, category: 'node' },
      ],
    })
    await prismaTest.rbacUserPermission.createMany({
      data: [
        {
          id: 'grant-gate2-vm',
          userId: 'user-msp-gate2',
          permissionId: 'perm_vm_view_gate2',
          scopeType: 'connection',
          scopeTarget: 'conn-1',
          tenantId: NON_DEFAULT_TENANT,
          grantedAt: now,
        },
        {
          id: 'grant-gate2-node',
          userId: 'user-msp-gate2',
          permissionId: 'perm_node_view_gate2',
          scopeType: 'connection',
          scopeTarget: 'conn-1',
          tenantId: NON_DEFAULT_TENANT,
          grantedAt: now,
        },
      ],
    })
  }

  const sessionPrincipal: Principal = {
    kind: 'session', userId: 'user-msp-gate2', tenantId: NON_DEFAULT_TENANT, connectionIds: null,
  }
  const vms = [{ id: 'conn-1:qemu:node1:100', connId: 'conn-1', node: 'node1', type: 'qemu', vmid: '100' }]
  const nodes = [{ connId: 'conn-1', node: 'node1' }]

  it('filterVmsByPermission returns REAL data for a Principal with no explicit tenantId', async () => {
    await seedConnectionScopedGrant()
    const out = await filterVmsByPermission(sessionPrincipal, vms, PERMISSIONS.VM_VIEW)
    expect(out).toEqual(vms)
  })

  it('filterNodesByPermission returns REAL data for a Principal with no explicit tenantId', async () => {
    await seedConnectionScopedGrant()
    const out = await filterNodesByPermission(sessionPrincipal, nodes, PERMISSIONS.NODE_VIEW)
    expect(out).toEqual(nodes)
  })

  it('getRbacInfraScope resolves the connection scope for a Principal with no explicit tenantId', async () => {
    await seedConnectionScopedGrant()
    const scope = await getRbacInfraScope(sessionPrincipal)
    expect(scope?.fullConnections.has('conn-1')).toBe(true)
  })

  it('getEffectivePermissions resolves the real permission set for a Principal with no explicit tenantId', async () => {
    await seedConnectionScopedGrant()
    const perms = await getEffectivePermissions(sessionPrincipal, 'connection', 'conn-1')
    expect(new Set(perms)).toEqual(new Set([PERMISSIONS.VM_VIEW, PERMISSIONS.NODE_VIEW]))
  })

  it('an explicit tenantId still wins over the principal (existing behaviour preserved)', async () => {
    await seedConnectionScopedGrant()
    const out = await filterVmsByPermission(sessionPrincipal, vms, PERMISSIONS.VM_VIEW, 'default')
    expect(out).toEqual([]) // 'default' has no such grant: the explicit arg was honoured, not the principal's own tenant
  })

  it('a plain userId string is unaffected: still needs an explicit tenantId (no Principal to fall back on)', async () => {
    await seedConnectionScopedGrant()
    const out = await filterVmsByPermission('user-msp-gate2', vms, PERMISSIONS.VM_VIEW)
    expect(out).toEqual([]) // no tenantId, no Principal -> DEFAULT_TENANT_ID, same as before this fix
  })
})

describe('module hygiene (contract assertion (b) precondition)', () => {
  it('rbac/index.ts no longer references getServerSession', async () => {
    const { readFileSync } = await import('node:fs')
    const source = readFileSync('src/lib/rbac/index.ts', 'utf8')
    expect(source.includes('getServerSession')).toBe(false)
  })
})

describe('getCurrentRbacInfraScope: the caller scope in one call (issue #525)', () => {
  it('returns null without any principal (the route already rejected that caller)', async () => {
    expect(await getCurrentRbacInfraScope()).toBeNull()
  })

  it('maps a connection-scoped token to a full-connection scope, a fleet-wide token to null', async () => {
    const scoped = await seedApiToken({ scopes: ['vms:read'], connectionIds: ['conn-1'] })
    headersMock.mockResolvedValue(tokenHeaders(scoped.secret, 'vms-list', '/api/v1/vms'))
    const scope = await getCurrentRbacInfraScope()
    expect(scope?.fullConnections).toEqual(new Set(['conn-1']))
    expect(scope?.nodesByConnection.size).toBe(0)
    expect(scope?.guestDerived).toBe(false)

    const fleet = await seedApiToken({ scopes: ['vms:read'], connectionIds: null })
    headersMock.mockResolvedValue(tokenHeaders(fleet.secret, 'vms-list', '/api/v1/vms'))
    expect(await getCurrentRbacInfraScope()).toBeNull()
  })

  it('a grantless session user gets an empty, restricting scope rather than null', async () => {
    getServerSessionMock.mockResolvedValue({ user: { id: 'user-norant', tenantId: 'default' } })
    const scope = await getCurrentRbacInfraScope()
    expect(scope).not.toBeNull()
    expect(scope?.fullConnections.size).toBe(0)
    expect(scope?.nodesByConnection.size).toBe(0)
    expect(scope?.guestDerived).toBe(false)
  })
})
